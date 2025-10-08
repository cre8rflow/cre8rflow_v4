"use client";

import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "../../lib/utils";

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      // Base: make the interactive area comfortably large and draggable
      "relative z-10 flex touch-none select-none items-center justify-center bg-transparent",
      // Horizontal groups → vertical handle
      "h-full data-[panel-group-direction=horizontal]:w-2 data-[panel-group-direction=horizontal]:cursor-col-resize",
      // Vertical groups → horizontal handle
      "w-full data-[panel-group-direction=vertical]:h-2 data-[panel-group-direction=vertical]:cursor-row-resize",
      // Visual hairline indicator using ::after so the hit area stays wide
      "after:absolute after:bg-border/70 data-[panel-group-direction=horizontal]:after:inset-y-0 data-[panel-group-direction=horizontal]:after:left-1/2 data-[panel-group-direction=horizontal]:after:w-px data-[panel-group-direction=horizontal]:after:-translate-x-1/2 data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:top-1/2 data-[panel-group-direction=vertical]:after:h-px data-[panel-group-direction=vertical]:after:-translate-y-1/2",
      // Focus styles for a11y
      "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
      className
    )}
    {...props}
  >
    {withHandle ? (
      <div
        aria-hidden
        className={cn(
          // Centered grip dots/line for affordance
          "pointer-events-none rounded-full bg-border/80",
          // Size and orientation of the grip
          "data-[panel-group-direction=horizontal]:h-10 data-[panel-group-direction=horizontal]:w-1",
          "data-[panel-group-direction=vertical]:h-1 data-[panel-group-direction=vertical]:w-10"
        )}
      />
    ) : null}
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
