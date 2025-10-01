"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, SquarePen, Trash, LogOut, Bell } from "lucide-react";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { HeaderBase } from "../header-base";
import { useProjectStore } from "@/stores/project-store";
import { KeyboardShortcutsHelp } from "../keyboard-shortcuts-help";
import { RenameProjectDialog } from "../rename-project-dialog";
import { DeleteProjectDialog } from "../delete-project-dialog";
import { ExportButton } from "./export-button";
import { ThemeToggle } from "../theme-toggle";
import { PanelPresetSelector } from "./panel-preset-selector";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/templates", label: "Templates" },
  { href: "/billing", label: "Billing" },
  { href: "/account", label: "Account" },
];

export function EditorHeader() {
  const { activeProject, renameProject, deleteProject } = useProjectStore();
  const pathname = usePathname();
  const router = useRouter();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);

  const activeLink = useMemo(() => {
    if (!pathname) return null;
    return (
      NAV_LINKS.find((link) => pathname.startsWith(link.href))?.href ?? null
    );
  }, [pathname]);

  const handleNameSave = async (newName: string) => {
    if (activeProject && newName.trim() && newName !== activeProject.name) {
      try {
        await renameProject(activeProject.id, newName.trim());
        setIsRenameDialogOpen(false);
      } catch (error) {
        console.error("Failed to rename project:", error);
      }
    }
  };

  const handleDelete = () => {
    if (!activeProject) return;
    deleteProject(activeProject.id);
    setIsDeleteDialogOpen(false);
    router.push("/projects");
  };

  const leftContent = (
    <div className="flex items-center gap-5">
      <Link href="/" className="flex items-center gap-2">
        <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-quick-action shadow-soft">
          <Image
            src="/Kallio_v2.png"
            alt="Kallio logo"
            width={40}
            height={40}
            priority
            className="h-full w-full object-cover"
          />
        </span>
        <span className="text-lg font-semibold tracking-tight">Kallio</span>
      </Link>
      <nav className="hidden lg:flex items-center gap-1 text-sm">
        {NAV_LINKS.map((link) => {
          const isActive = activeLink === link.href;
          return (
            <Link key={link.href} href={link.href}>
              <Button
                variant="ghost"
                className={
                  isActive
                    ? "bg-surface-muted/60 text-white"
                    : "text-muted-foreground hover:bg-surface-muted/40"
                }
              >
                {link.label}
              </Button>
            </Link>
          );
        })}
      </nav>
    </div>
  );

  const centerContent = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="bg-surface-muted/60 text-foreground shadow-soft transition hover:bg-surface-muted"
          size="sm"
        >
          <span className="mr-2 max-w-[12rem] truncate text-sm font-medium">
            {activeProject?.name ?? "Untitled Project"}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-56 bg-surface-elevated shadow-soft"
      >
        <DropdownMenuItem onClick={() => router.push("/projects")}>
          Back to projects
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setIsRenameDialogOpen(true)}>
          <SquarePen className="mr-2 h-4 w-4" /> Rename project
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setIsDeleteDialogOpen(true)}
          className="text-destructive focus:bg-destructive/10"
        >
          <Trash className="mr-2 h-4 w-4" /> Delete project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rightContent = (
    <div className="flex items-center gap-2">
      <PanelPresetSelector />
      <KeyboardShortcutsHelp />
      <ExportButton />
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-white"
      >
        <Bell className="h-5 w-5" />
        <span className="sr-only">Notifications</span>
      </Button>
      <ThemeToggle />
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-white"
        onClick={() => router.push("/projects")}
      >
        <LogOut className="h-5 w-5" />
        <span className="sr-only">Exit editor</span>
      </Button>
    </div>
  );

  return (
    <>
      <HeaderBase
        leftContent={leftContent}
        centerContent={centerContent}
        rightContent={rightContent}
        className="h-[4.25rem] items-center border-b border-border/40 bg-surface-elevated/80 px-6 shadow-soft backdrop-blur"
      />
      <RenameProjectDialog
        isOpen={isRenameDialogOpen}
        onOpenChange={setIsRenameDialogOpen}
        onConfirm={handleNameSave}
        projectName={activeProject?.name || ""}
      />
      <DeleteProjectDialog
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDelete}
        projectName={activeProject?.name || ""}
      />
    </>
  );
}
