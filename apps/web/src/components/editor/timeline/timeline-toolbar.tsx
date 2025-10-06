import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { useSceneStore } from "@/stores/scene-store";
import { toast } from "sonner";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Pause,
  Play,
  SkipBack,
  // Bookmark,
  // Magnet,
  // Link,
  ZoomOut,
  ZoomIn,
  Copy,
  Trash2,
  ScissorsSquare,
  ArrowLeftCircle,
  ArrowRightCircle,
  Volume2,
} from "lucide-react";
// import {
//   SplitButton,
//   SplitButtonLeft,
//   SplitButtonRight,
//   SplitButtonSeparator,
// } from "@/components/ui/split-button";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_FPS } from "@/stores/project-store";
import { formatTimeCode } from "@/lib/time";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { EditableTimecode } from "@/components/ui/editable-timecode";
// import { ScenesView } from "../scenes-view";

export function TimelineToolbar({
  zoomLevel,
  setZoomLevel,
}: {
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
}) {
  const {
    tracks,
    addTrack,
    addElementToTrack,
    selectedElements,
    clearSelectedElements,
    deleteSelected,
    splitSelected,
    splitAndKeepLeft,
    splitAndKeepRight,
    separateAudio,
    snappingEnabled,
    // toggleSnapping,
    // rippleEditingEnabled,
    // toggleRippleEditing,
  } = useTimelineStore();
  const { currentTime, duration, isPlaying, toggle, seek } = usePlaybackStore();
  const { /* toggleBookmark, isBookmarked, */ activeProject } = useProjectStore();
  // const { scenes, currentScene } = useSceneStore();

  const handleSplitSelected = () => {
    splitSelected(currentTime);
  };

  const handleDuplicateSelected = () => {
    if (selectedElements.length === 0) return;
    const canDuplicate = selectedElements.length === 1;
    if (!canDuplicate) return;

    selectedElements.forEach(({ trackId, elementId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((el) => el.id === elementId);
      if (element) {
        const newStartTime =
          element.startTime +
          (element.duration - element.trimStart - element.trimEnd) +
          0.1;
        const { id, ...elementWithoutId } = element;
        addElementToTrack(trackId, {
          ...elementWithoutId,
          startTime: newStartTime,
        });
      }
    });
    clearSelectedElements();
  };

  const handleSplitAndKeepLeft = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((c) => c.id === elementId);
    if (!element) return;
    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);
    if (currentTime <= effectiveStart || currentTime >= effectiveEnd) {
      toast.error("Playhead must be within selected element");
      return;
    }
    splitAndKeepLeft(trackId, elementId, currentTime);
  };

  const handleSplitAndKeepRight = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one element");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    const element = track?.elements.find((c) => c.id === elementId);
    if (!element) return;
    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);
    if (currentTime <= effectiveStart || currentTime >= effectiveEnd) {
      toast.error("Playhead must be within selected element");
      return;
    }
    splitAndKeepRight(trackId, elementId, currentTime);
  };

  const handleSeparateAudio = () => {
    if (selectedElements.length !== 1) {
      toast.error("Select exactly one media element to separate audio");
      return;
    }
    const { trackId, elementId } = selectedElements[0];
    const track = tracks.find((t) => t.id === trackId);
    if (!track || track.type !== "media") {
      toast.error("Select a media element to separate audio");
      return;
    }
    separateAudio(trackId, elementId);
  };

  const handleDeleteSelected = () => {
    deleteSelected();
  };

  const handleZoomIn = () => {
    setZoomLevel(Math.min(4, zoomLevel + 0.25));
  };

  const handleZoomOut = () => {
    setZoomLevel(Math.max(0.25, zoomLevel - 0.25));
  };

  const handleZoomSliderChange = (values: number[]) => {
    setZoomLevel(values[0]);
  };

  // const handleFreezeSelected = () => {
  //   toast.info("Freeze frame functionality coming soon!");
  // };

  // const handleToggleBookmark = async () => {
  //   await toggleBookmark(currentTime);
  // };

  // const currentBookmarked = isBookmarked(currentTime);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/40 bg-surface-base/70 px-4 py-2.5 shadow-soft">
      <div className="flex items-center gap-2">
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={toggle}
              >
                {isPlaying ? (
                  <Pause className="h-[1.05rem] w-[1.05rem]" />
                ) : (
                  <Play className="h-[1.05rem] w-[1.05rem]" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPlaying ? "Pause (Space)" : "Play (Space)"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={() => seek(0)}
              >
                <SkipBack className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Return to Start (Home / Enter)</TooltipContent>
          </Tooltip>
          <div className="mx-2 h-6 w-px bg-border/50" />
          {/* Time Display */}
          <div className="flex flex-row items-center justify-center rounded-xl bg-surface-elevated/60 px-3 py-1.5 shadow-soft">
            <EditableTimecode
              time={currentTime}
              duration={duration}
              format="HH:MM:SS:FF"
              fps={activeProject?.fps ?? DEFAULT_FPS}
              onTimeChange={seek}
              className="text-center text-sm"
            />
            <div className="px-2 text-xs font-mono text-muted-foreground/80">
              /
            </div>
            <div className="text-xs font-mono text-muted-foreground/80 text-center">
              {formatTimeCode(duration, "HH:MM:SS:FF")}
            </div>
          </div>
          {tracks.length === 0 && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const trackId = addTrack("media");
                      addElementToTrack(trackId, {
                        type: "media",
                        mediaId: "test",
                        name: "Test Clip",
                        duration: TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
                        startTime: 0,
                        trimStart: 0,
                        trimEnd: 0,
                      });
                    }}
                    className="text-xs"
                  >
                    Add Test Clip
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add a test clip to try playback</TooltipContent>
              </Tooltip>
            </>
          )}
          <div className="w-px h-6 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleSplitSelected}
              >
                <ScissorsSquare className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split element (Ctrl+S)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleSplitAndKeepLeft}
              >
                <ArrowLeftCircle className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split and keep left (Ctrl+Q)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleSplitAndKeepRight}
              >
                <ArrowRightCircle className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split and keep right (Ctrl+W)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleSeparateAudio}
              >
                <Volume2 className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Separate audio (Ctrl+Shift+A)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleDuplicateSelected}
              >
                <Copy className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate element (Ctrl+D)</TooltipContent>
          </Tooltip>
          {/* <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleFreezeSelected}
              >
                <Snowflake className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Freeze frame (F)</TooltipContent>
          </Tooltip> */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="h-[1.05rem] w-[1.05rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete element (Delete)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {/* <div>
        <SplitButton className="border border-foreground/10">
          <SplitButtonLeft>{currentScene?.name || "No Scene"}</SplitButtonLeft>
          <SplitButtonSeparator />
          <ScenesView>
            <SplitButtonRight disabled={scenes.length === 1} onClick={() => {}}>
              <LayersIcon />
            </SplitButtonRight>
          </ScenesView>
        </SplitButton>
      </div> */}
      <div className="flex items-center gap-2">
        <TooltipProvider delayDuration={500}>
          {/* <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleSnapping}>
                {snappingEnabled ? (
                  <Magnet className="h-[1.05rem] w-[1.05rem] text-primary" />
                ) : (
                  <Magnet className="h-[1.05rem] w-[1.05rem]" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Auto snapping</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleRippleEditing}>
                <Link
                  className={`h-[1.05rem] w-[1.05rem] ${
                    rippleEditingEnabled ? "text-primary" : ""
                  }`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {rippleEditingEnabled
                ? "Disable Ripple Editing"
                : "Enable Ripple Editing"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
                onClick={handleToggleBookmark}
              >
                <Bookmark
                  className={`h-[1.05rem] w-[1.05rem] ${currentBookmarked ? "fill-primary text-primary" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {currentBookmarked ? "Remove bookmark" : "Add bookmark"}
            </TooltipContent>
          </Tooltip> */}
        </TooltipProvider>

        <div className="h-6 w-px bg-border mx-1" />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
            onClick={handleZoomOut}
          >
            <ZoomOut className="h-[1.05rem] w-[1.05rem]" />
          </Button>
          <Slider
            className="w-24"
            value={[zoomLevel]}
            onValueChange={handleZoomSliderChange}
            min={0.25}
            max={4}
            step={0.25}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl border border-transparent hover:border-border/40"
            onClick={handleZoomIn}
          >
            <ZoomIn className="h-[1.05rem] w-[1.05rem]" />
          </Button>
        </div>
      </div>
    </div>
  );
}
