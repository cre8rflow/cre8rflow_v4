"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { MediaPanel } from "@/components/editor/media-panel";
import { AgentPanel } from "@/components/editor/agent/agent-panel";
import { Timeline } from "@/components/editor/timeline";
import { PreviewPanel } from "@/components/editor/preview-panel";
import { EditorHeader } from "@/components/editor/editor-header";
import { EditorSidebar } from "@/components/editor/editor-sidebar";
import { usePanelStore } from "@/stores/panel-store";
import { useProjectStore } from "@/stores/project-store";
import { EditorProvider } from "@/components/providers/editor-provider";
import { usePlaybackControls } from "@/hooks/use-playback-controls";
import { Onboarding } from "@/components/editor/onboarding";

export default function Editor() {
  const {
    toolsPanel,
    previewPanel,
    propertiesPanel,
    mainContent,
    timeline,
    setToolsPanel,
    setPreviewPanel,
    setPropertiesPanel,
    setMainContent,
    setTimeline,
    isMediaPanelOpen,
    isAgentPanelOpen,
  } = usePanelStore();

  const renderPreviewWorkspace = () => (
    <div className="flex h-full min-h-0 w-full bg-surface-base/80 p-3">
      {isAgentPanelOpen ? (
        <div className="flex-1 rounded-2xl bg-surface-elevated/95 shadow-soft">
          <ResizablePanelGroup direction="horizontal" className="flex h-full">
            <ResizablePanel
              defaultSize={100 - propertiesPanel}
              minSize={45}
              onResize={(size) => setPropertiesPanel(100 - size)}
              className="min-w-0"
            >
              <div className="h-full w-full overflow-hidden rounded-l-2xl">
                <PreviewPanel />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize={propertiesPanel}
              minSize={20}
              maxSize={40}
              onResize={setPropertiesPanel}
              className="min-w-0"
            >
              <div className="h-full w-full overflow-hidden rounded-r-2xl bg-surface-elevated/95">
                <AgentPanel />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="flex-1 rounded-2xl bg-surface-elevated/95 shadow-soft overflow-hidden">
          <PreviewPanel />
        </div>
      )}
    </div>
  );

  const {
    activeProject,
    loadProject,
    createNewProject,
    isInvalidProjectId,
    markProjectIdAsInvalid,
  } = useProjectStore();
  const params = useParams();
  const router = useRouter();
  const projectId = params.project_id as string;
  const handledProjectIds = useRef<Set<string>>(new Set());
  const isInitializingRef = useRef<boolean>(false);

  usePlaybackControls();

  useEffect(() => {
    let isCancelled = false;

    const initProject = async () => {
      if (!projectId) {
        return;
      }

      // Prevent duplicate initialization
      if (isInitializingRef.current) {
        return;
      }

      // Check if project is already loaded
      if (activeProject?.id === projectId) {
        return;
      }

      // Check global invalid tracking first (most important for preventing duplicates)
      if (isInvalidProjectId(projectId)) {
        return;
      }

      // Check if we've already handled this project ID locally
      if (handledProjectIds.current.has(projectId)) {
        return;
      }

      // Mark as initializing to prevent race conditions
      isInitializingRef.current = true;
      handledProjectIds.current.add(projectId);

      try {
        await loadProject(projectId);

        // Check if component was unmounted during async operation
        if (isCancelled) {
          return;
        }

        // Project loaded successfully
        isInitializingRef.current = false;
      } catch (error) {
        // Check if component was unmounted during async operation
        if (isCancelled) {
          return;
        }

        // More specific error handling - only create new project for actual "not found" errors
        const isProjectNotFound =
          error instanceof Error &&
          (error.message.includes("not found") ||
            error.message.includes("does not exist") ||
            error.message.includes("Project not found"));

        if (isProjectNotFound) {
          // Mark this project ID as invalid globally BEFORE creating project
          markProjectIdAsInvalid(projectId);

          try {
            const newProjectId = await createNewProject("Untitled Project");

            // Check again if component was unmounted
            if (isCancelled) {
              return;
            }

            router.replace(`/editor/${newProjectId}`);
          } catch (createError) {
            console.error("Failed to create new project:", createError);
          }
        } else {
          // For other errors (storage issues, corruption, etc.), don't create new project
          console.error(
            "Project loading failed with recoverable error:",
            error
          );
          // Remove from handled set so user can retry
          handledProjectIds.current.delete(projectId);
        }

        isInitializingRef.current = false;
      }
    };

    initProject();

    // Cleanup function to cancel async operations
    return () => {
      isCancelled = true;
      isInitializingRef.current = false;
    };
  }, [
    projectId,
    loadProject,
    createNewProject,
    router,
    isInvalidProjectId,
    markProjectIdAsInvalid,
  ]);

  return (
    <EditorProvider>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
        <EditorHeader />
        <div className="flex flex-1 min-h-0 min-w-0">
          <EditorSidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <ResizablePanelGroup
              key="editor-shell"
              direction="vertical"
              className="flex-1 min-h-0"
            >
              <ResizablePanel
                defaultSize={mainContent}
                minSize={40}
                onResize={setMainContent}
                className="min-h-0"
              >
                <div className="flex h-full min-h-0 w-full px-3 pt-3">
                  {isMediaPanelOpen ? (
                    <ResizablePanelGroup
                      key="with-media"
                      direction="horizontal"
                      className="flex-1 min-w-0 rounded-2xl bg-surface-elevated shadow-soft overflow-hidden"
                    >
                      <ResizablePanel
                        defaultSize={toolsPanel}
                        minSize={18}
                        maxSize={35}
                        onResize={setToolsPanel}
                        className="min-w-0"
                      >
                        <div className="h-full w-full bg-panel-gradient p-3">
                          <MediaPanel />
                        </div>
                      </ResizablePanel>

                      <ResizableHandle withHandle />

                      <ResizablePanel
                        defaultSize={previewPanel}
                        minSize={35}
                        onResize={setPreviewPanel}
                        className="min-w-0 min-h-0"
                      >
                        {renderPreviewWorkspace()}
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  ) : (
                    <div className="flex-1 min-w-0 rounded-2xl bg-surface-elevated shadow-soft overflow-hidden">
                      {renderPreviewWorkspace()}
                    </div>
                  )}
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={timeline}
                minSize={20}
                maxSize={60}
                onResize={setTimeline}
                className="min-h-0"
              >
                <div className="h-full w-full px-3 pb-3">
                  <div className="h-full rounded-2xl bg-surface-elevated shadow-soft">
                    <Timeline />
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
        <Onboarding />
      </div>
    </EditorProvider>
  );
}
