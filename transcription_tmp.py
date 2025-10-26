import modal
from pydantic import BaseModel

app = modal.App("kallio-transcription")

BASE_IMAGE = (
    modal.Image.debian_slim()
    # Bake in ffmpeg and required python deps
    .apt_install(["ffmpeg"])
    .pip_install(
        [
            "openai-whisper",
            "boto3",
            "fastapi[standard]",
            "pydantic",
            "cryptography",
            "webrtcvad",
            "numpy",
        ]
    )
)

class TranscribeRequest(BaseModel):
    filename: str
    language: str = "auto"
    decryptionKey: str | None = None
    iv: str | None = None

class TrimDeadspaceRequest(BaseModel):
    filename: str
    language: str = "auto"
    prePadding: float = 0.08
    postPadding: float = 0.6
    aggressiveness: int = 3  # 0-3
    frameMs: int = 30  # 10 / 20 / 30 supported by VAD
    decryptionKey: str | None = None
    iv: str | None = None

# 1 Infra as parameters
@app.function(
    image=BASE_IMAGE,
    gpu="A10G",
    timeout=300, # 5m
    secrets=[modal.Secret.from_name("kallio-r2-secrets")]
)
@modal.fastapi_endpoint(method="POST")
def transcribe_audio(request: TranscribeRequest):
    import whisper
    import boto3
    import tempfile
    import os
    import json
    
    try:
        filename = request.filename
        language = request.language
        decryption_key = request.decryptionKey
        iv = request.iv
        
        if not filename:
            return {
                "error": "Missing filename parameter"
            }
        
        #3 Initialize R2 client. If key, then decrpty inside container
        s3_client = boto3.client(
            's3',
            endpoint_url=f'https://{os.environ["CLOUDFLARE_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name='auto'
        )
        
        # Create temporary file for audio
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
            temp_path = temp_file.name
            
            try:
                # Download audio from R2
                s3_client.download_file(
                    os.environ["R2_BUCKET_NAME"], 
                    filename, 
                    temp_path
                )
                
                # If decryption key provided, decrypt the file directly (zero-knowledge)
                if decryption_key and iv:
                    import base64
                    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
                    from cryptography.hazmat.backends import default_backend
                    
                    # Read the encrypted file
                    with open(temp_path, 'rb') as f:
                        encrypted_data = f.read()
                    
                    # Decode the key and IV from base64
                    key_bytes = base64.b64decode(decryption_key)
                    iv_bytes = base64.b64decode(iv)
                    
                    # Decrypt the data using AES-GCM
                    # Extract the tag (last 16 bytes) and ciphertext
                    tag = encrypted_data[-16:]
                    ciphertext = encrypted_data[:-16]
                    
                    cipher = Cipher(
                        algorithms.AES(key_bytes),
                        modes.GCM(iv_bytes, tag),
                        backend=default_backend()
                    )
                    decryptor = cipher.decryptor()
                    decrypted_data = decryptor.update(ciphertext) + decryptor.finalize()
                    
                    # Write decrypted audio back to temp file
                    with open(temp_path, 'wb') as f:
                        f.write(decrypted_data)
                
                #4 Modal init + inference 
                # Load Whisper model
                model = whisper.load_model("base")

                # Transcribe audio with word-level timestamps
                transcribe_kwargs = {
                    "word_timestamps": True,
                    "verbose": False,
                }
                if language != "auto":
                    transcribe_kwargs["language"] = language.lower()

                result = model.transcribe(temp_path, **transcribe_kwargs)

                # Delete audio file from R2 (cleanup)
                s3_client.delete_object(
                    Bucket=os.environ["R2_BUCKET_NAME"],
                    Key=filename
                )
                
                # Adjust segment timing using word timestamps (Whisper often trails by ~500ms)
                adjusted_segments = []

                def _adjust_time(value: float) -> float:
                    return max(0.0, float(value))

                for segment in result.get("segments", []):
                    adjusted_segment = segment.copy()

                    # Collect words with adjusted timing
                    adjusted_words = []
                    for word in segment.get("words", []) or []:
                        text = str(word.get("word") or "").strip()
                        if not text:
                            continue
                        raw_start = float(word.get("start", segment.get("start", 0.0)))
                        raw_end = float(word.get("end", segment.get("end", 0.0)))
                        word_start = _adjust_time(raw_start)
                        # Preserve original end so we don't truncate the final word
                        word_end = max(word_start, raw_end)
                        adjusted_words.append(
                            {
                                "start": word_start,
                                "end": word_end,
                                "text": text,
                            }
                        )

                    if adjusted_words:
                        first_word_start = adjusted_words[0]["start"]
                        last_word_end = adjusted_words[-1]["end"]
                    else:
                        first_word_start = _adjust_time(segment.get("start", 0.0))
                        raw_segment_end = float(segment.get("end", first_word_start + 0.5))
                        last_word_end = max(first_word_start, raw_segment_end)

                    adjusted_segment["start"] = first_word_start
                    adjusted_segment["end"] = last_word_end
                    adjusted_segment["words"] = adjusted_words
                    adjusted_segment["firstWordStart"] = first_word_start
                    adjusted_segment["lastWordEnd"] = last_word_end

                    adjusted_segments.append(adjusted_segment)
                
                #5 Shaped JSON
                payload = {
                    "text": result["text"],
                    "segments": adjusted_segments,
                    "language": result["language"]
                }

                try:
                    preview = {
                        "language": payload["language"],
                        "textPreview": payload["text"][:120],
                        "segmentCount": len(payload["segments"]),
                        "segments": [
                            {
                                "start": seg.get("start"),
                                "end": seg.get("end"),
                                "text": seg.get("text"),
                                "wordCount": len(seg.get("words", [])),
                            }
                            for seg in payload["segments"][:5]
                        ],
                    }
                    print("[transcribe_audio] Modal response:", json.dumps(preview))
                except Exception as log_error:
                    print("[transcribe_audio] Failed to log preview:", log_error)

                return payload
                
            finally:
                # Clean up temporary file
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
                    
    except Exception as e:
        import traceback
        print(f"Transcription error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        
        # Return error response that matches expected format
        return {
            "error": str(e),
            "text": "",
                "segments": [],
                "language": "unknown"
            }

@app.function(
    image=BASE_IMAGE,
    timeout=180,
    secrets=[modal.Secret.from_name("kallio-r2-secrets")]
)
@modal.fastapi_endpoint(method="POST")
def trim_deadspace(request: TrimDeadspaceRequest):
    import boto3
    import tempfile
    import os
    import base64
    import subprocess
    import wave
    import contextlib
    import numpy as np
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    import whisper
    import json

    response = {
        "speechDetected": False,
        "speechStart": 0.0,
        "speechEnd": 0.0,
        "speechDuration": 0.0,
        "trimStart": 0.0,
        "trimEnd": 0.0,
        "duration": 0.0,
        "confidence": 0.0,
        "padding": {
            "pre": max(0.0, float(request.prePadding)),
            "post": max(0.0, float(request.postPadding)),
        },
        "analysisSource": "transcript",
        "transcript": None,
    }

    frame_ms = int(request.frameMs)
    if frame_ms not in (10, 20, 30):
        frame_ms = 30

    s3_client = boto3.client(
        "s3",
        endpoint_url=f'https://{os.environ["CLOUDFLARE_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    original_path = None
    pcm_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".bin") as temp_file:
            original_path = temp_file.name

        s3_client.download_file(
            os.environ["R2_BUCKET_NAME"],
            request.filename,
            original_path,
        )

        if request.decryptionKey and request.iv:
            with open(original_path, "rb") as encrypted:
                encrypted_data = encrypted.read()

            key_bytes = base64.b64decode(request.decryptionKey)
            iv_bytes = base64.b64decode(request.iv)
            tag = encrypted_data[-16:]
            ciphertext = encrypted_data[:-16]

            cipher = Cipher(
                algorithms.AES(key_bytes),
                modes.GCM(iv_bytes, tag),
                backend=default_backend(),
            )
            decryptor = cipher.decryptor()
            decrypted_data = decryptor.update(ciphertext) + decryptor.finalize()

            with open(original_path, "wb") as decrypted:
                decrypted.write(decrypted_data)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as pcm_file:
            pcm_path = pcm_file.name

        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-i",
            original_path,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            pcm_path,
        ]
        subprocess.run(
            ffmpeg_cmd,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        with contextlib.closing(wave.open(pcm_path, "rb")) as wf:
            sample_rate = wf.getframerate()
            sample_width = wf.getsampwidth()
            channels = wf.getnchannels()
            if sample_rate != 16000 or sample_width != 2 or channels != 1:
                raise ValueError(
                    f"Expected 16kHz mono PCM wav. Got {sample_rate}Hz, {channels}ch, width {sample_width}"
                )

            audio = wf.readframes(wf.getnframes())
            total_frames = wf.getnframes()

        frame_byte_count = int(sample_rate * (frame_ms / 1000.0) * sample_width)
        if frame_byte_count == 0:
            raise ValueError("Frame configuration produced zero-length frames.")

        frames = []
        timestamps = []
        for offset in range(0, len(audio) - frame_byte_count + 1, frame_byte_count):
            frame = audio[offset : offset + frame_byte_count]
            timestamp = (offset / sample_width) / sample_rate
            frames.append(frame)
            timestamps.append(timestamp)

        if not frames:
            response["duration"] = total_frames / sample_rate if sample_rate else 0.0
            return response | {"error": "Audio too short for analysis."}

        total_duration = (total_frames / sample_rate) if sample_rate else 0.0
        response["duration"] = total_duration

        frame_duration_sec = frame_ms / 1000.0

        # ------------------------------------------------------------------
        # RMS energy scan to detect speech clusters
        # ------------------------------------------------------------------
        energies: list[float] = []
        for frame in frames:
            if not frame:
                energies.append(0.0)
                continue
            samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
            if samples.size == 0:
                energies.append(0.0)
                continue
            rms = float(np.sqrt(np.mean(samples ** 2)))
            energies.append(rms)

        energies_arr = np.array(energies, dtype=np.float32)
        if energies_arr.size == 0:
            return response | {"error": "Unable to analyse audio energy."}

        noise_floor = float(np.percentile(energies_arr, 60.0))
        signal_peak = float(np.percentile(energies_arr, 95.0))
        threshold = max(noise_floor * 1.5, signal_peak * 0.2, 50.0)

        min_active_frames = max(2, int(0.12 / frame_duration_sec))
        active_flags = energies_arr >= threshold

        clusters: list[tuple[int, int]] = []
        start_idx: int | None = None
        for idx, flag in enumerate(active_flags):
            if flag and start_idx is None:
                start_idx = idx
            elif not flag and start_idx is not None:
                clusters.append((start_idx, idx))
                start_idx = None
        if start_idx is not None:
            clusters.append((start_idx, len(active_flags)))

        clusters = [
            (s, e)
            for (s, e) in clusters
            if (e - s) >= min_active_frames
        ]

        if not clusters:
            return response | {"error": "Unable to detect speech via energy analysis."}

        # Keep earliest and latest clusters for later refinement
        cluster_start_idx, cluster_end_idx = clusters[-1]
        silence_end_idx = clusters[0][0]
        silence_end_time = timestamps[silence_end_idx]

        cluster_start_time = timestamps[cluster_start_idx]
        last_frame_idx = min(cluster_end_idx, len(timestamps)) - 1
        cluster_end_time = min(
            total_duration,
            timestamps[last_frame_idx] + frame_duration_sec,
        )

        speech_duration = max(0.0, cluster_end_time - cluster_start_time)
        trim_start = max(0.0, silence_end_time - response["padding"]["pre"])
        trim_end = min(
            total_duration,
            cluster_end_time + response["padding"]["post"],
        )

        response.update(
            {
                "speechDetected": True,
                "speechStart": silence_end_time,
                "speechEnd": cluster_end_time,
                "speechDuration": speech_duration,
                "trimStart": trim_start,
                "trimEnd": trim_end,
                "confidence": float(
                    (cluster_end_idx - cluster_start_idx) / max(1, len(active_flags))
                ),
            }
        )

        try:
            cluster_debug = [
                {
                    "start_idx": int(s),
                    "end_idx": int(e),
                    "start_time": round(timestamps[s], 3),
                    "end_time": round(
                        timestamps[min(e, len(timestamps)) - 1] + frame_duration_sec, 3
                    ),
                    "peak_rms": float(energies_arr[s:e].max()) if e > s else 0.0,
                }
                for (s, e) in clusters
            ]
            print(
                "[trim_deadspace] energy_clusters=",
                json.dumps(
                    {
                        "clusters": cluster_debug,
                        "silence_end_time": round(silence_end_time, 3),
                        "initial_trim_start": round(trim_start, 3),
                        "initial_trim_end": round(trim_end, 3),
                        "threshold": float(threshold),
                    }
                ),
            )
        except Exception as log_error:
            print("[trim_deadspace] Failed to log energy clusters:", log_error)

    # ------------------------------------------------------------------
    # Whisper transcript refinement (handles restarts & tail clicks)
    # ------------------------------------------------------------------
    transcript_info = None
    response['transcript'] = None

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

    except Exception as e:
        import traceback

        return response | {
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
    finally:
        try:
            s3_client.delete_object(
                Bucket=os.environ["R2_BUCKET_NAME"],
                Key=request.filename,
            )
        except Exception:
            pass
        if original_path and os.path.exists(original_path):
            os.unlink(original_path)
        if pcm_path and os.path.exists(pcm_path):
            os.unlink(pcm_path)

@app.local_entrypoint()
def main():
    # Test function - you can call this with modal run transcription.py
    print("Transcription service is ready to deploy!")
    print("Deploy with: modal deploy transcription.py")

    #test
