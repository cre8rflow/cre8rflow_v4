def foo():
        try:
            total_duration = response["duration"]
    
            def _adjust_time(value: float) -> float:
                return max(0.0, float(value))
    
            whisper_model = getattr(trim_deadspace, "_whisper_model", None)
            if whisper_model is None:
                whisper_model = whisper.load_model("base")
                setattr(trim_deadspace, "_whisper_model", whisper_model)
    
            transcription = whisper_model.transcribe(
                pcm_path,
                language=(request.language or "auto").lower(),
                verbose=False,
                word_timestamps=True,
            )
            segments = transcription.get("segments") or []
    
            filtered_segments: list[dict[str, float | str | list]] = []
            for seg in segments:
                text = (seg.get("text") or "").strip()
                start = _adjust_time(seg.get("start", 0.0))
                raw_end = float(seg.get("end", 0.0))
                end = max(start, raw_end)
                no_speech_prob = float(seg.get("no_speech_prob", 1.0))
                duration_seg = max(0.0, end - start)
                words: list[dict[str, float | str]] = []
                for word in seg.get("words") or []:
                    try:
                        raw_word_start = float(word.get("start", start))
                        raw_word_end = float(word.get("end", end))
                        word_start = _adjust_time(raw_word_start)
                        word_end = max(word_start, raw_word_end)
                        word_text = str(word.get("word") or "").strip()
                        if word_text:
                            words.append(
                                {
                                    "start": word_start,
                                    "end": word_end,
                                    "text": word_text,
                                }
                            )
                    except Exception:
                        continue
    
                if not words:
                    if duration_seg <= 0.0:
                        continue
                    words.append(
                        {
                            "start": start,
                            "end": end,
                            "text": text,
                        }
                    )
                if duration_seg < 0.05:
                    continue
                if no_speech_prob >= 0.9:
                    continue
    
                filtered_segments.append(
                    {
                        "start": start,
                        "end": end,
                        "text": text,
                        "no_speech_prob": no_speech_prob,
                        "words": words,
                        "firstWordStart": words[0]["start"],
                        "lastWordEnd": max(w["end"] for w in words),
                    }
                )
    
            transcript_info = None
            if filtered_segments:
                window_start = response["speechStart"]
                window_end = response["speechEnd"]
                usable_segments = [
                    seg
                    for seg in filtered_segments
                    if seg["lastWordEnd"] > window_start - 0.3
                    and seg["firstWordStart"] < window_end + 0.3
                ]
                if not usable_segments:
                    usable_segments = filtered_segments
    
                # Detect restarts by comparing early text segments
                def normalized(text: str) -> str:
                    return " ".join(text.lower().split())
    
                normalized_segments = [
                    {
                        "start": seg["firstWordStart"],
                        "end": seg["lastWordEnd"],
                        "text": normalized(seg["text"]),
                        "original": seg,
                    }
                    for seg in filtered_segments
                ]
    
                seen_texts: dict[str, float] = {}
                restart_cutoff = 0.0
                for segment in normalized_segments:
                    text = segment["text"]
                    start_time = segment["start"]
                    if text in seen_texts and start_time - seen_texts[text] > 0.4:
                        # Found a restart; mark cutoff at this occurrence
                        restart_cutoff = max(restart_cutoff, start_time)
                    else:
                        seen_texts[text] = start_time
    
                if restart_cutoff > 0.0:
                    usable_segments = [
                        seg
                        for seg in usable_segments
                        if seg["firstWordStart"] >= restart_cutoff
                    ]
                    silence_end_time = max(silence_end_time, restart_cutoff)
    
                overall_first_word = max(
                    silence_end_time,
                    min(seg["firstWordStart"] for seg in usable_segments),
                )
                overall_head_trim = max(
                    0.0, overall_first_word - response["padding"]["pre"]
                )
    
                cluster_source = usable_segments
                cluster = [cluster_source[-1]]
                cluster_gap = 1.5
                for seg in reversed(cluster_source[:-1]):
                    if cluster[0]["start"] - seg["end"] <= cluster_gap:
                        cluster.insert(0, seg)
                    else:
                        break
    
                cluster_first_word = min(seg["firstWordStart"] for seg in cluster)
                cluster_end = max(seg["lastWordEnd"] for seg in cluster)
                transcript_trim_end = min(
                    total_duration, cluster_end + response["padding"]["post"]
                )
    
                if transcript_trim_end > overall_head_trim:
                    response["analysisSource"] = "transcript"
                    response["speechStart"] = max(overall_first_word, silence_end_time)
                    response["speechEnd"] = cluster_end
                    response["speechDuration"] = max(
                        0.0, cluster_end - response["speechStart"]
                    )
                    response["trimStart"] = overall_head_trim
                    response["trimEnd"] = transcript_trim_end
                    response["confidence"] = max(
                        response.get("confidence", 0.0),
                        sum(1.0 - seg["no_speech_prob"] for seg in cluster) / len(cluster),
                    )
    
                    transcript_info = {
                        "start": overall_first_word,
                        "end": cluster_end,
                        "segments": [
                            {
                                "start": seg["firstWordStart"],
                                "end": seg["lastWordEnd"],
                                "text": seg["text"],
                                "words": seg["words"],
                                "firstWordStart": seg["firstWordStart"],
                                "lastWordEnd": seg["lastWordEnd"],
                            }
                            for seg in cluster
                        ],
                    }
    
            if not filtered_segments:
                return response | {
                    "error": "Transcript contained no spoken words.",
                }
    
            if response["speechEnd"] <= response["speechStart"]:
                response["speechDetected"] = False
                return response | {
                    "error": "Unable to identify speech boundaries from transcript.",
                }
    
            response["speechDetected"] = True
    
            if transcript_info:
                response["transcript"] = transcript_info
            else:
                response["transcript"] = {
                    "start": None,
                    "end": None,
                    "segments": [],
                }
        except Exception as transcript_error:
            response["transcript"] = {
                "start": None,
                "end": None,
                "segments": [],
                "error": str(transcript_error),
                }
    
            try:
                preview = {
                    "speechDetected": response.get("speechDetected"),
                    "analysisSource": response.get("analysisSource"),
                    "confidence": response.get("confidence"),
                    "trim": {
                        "start": response.get("trimStart"),
                        "end": response.get("trimEnd"),
                    },
                    "speech": {
                        "start": response.get("speechStart"),
                        "end": response.get("speechEnd"),
                    },
                    "transcriptSegments": [
                        {
                            "start": seg.get("start"),
                            "end": seg.get("end"),
                            "text": seg.get("text"),
                            "wordCount": len(seg.get("words", [])),
                        }
                        for seg in (response.get("transcript", {}) or {}).get("segments", [])[:5]
                    ],
                }
                print("[trim_deadspace] Analysis summary:", json.dumps(preview))
            except Exception as log_error:
                print("[trim_deadspace] Failed to log preview:", log_error)
    
            return response
    
