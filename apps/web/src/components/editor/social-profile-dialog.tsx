"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function SocialProfileDialog() {
  const [open, setOpen] = useState(false);
  const [instagramHandle, setInstagramHandle] = useState("");
  const [tiktokHandle, setTiktokHandle] = useState("");

  const resetForm = () => {
    setInstagramHandle("");
    setTiktokHandle("");
  };

  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      resetForm();
    }
  };

  const handleSubmit = () => {
    const summary = [
      instagramHandle.trim() && `Instagram: ${instagramHandle.trim()}`,
      tiktokHandle.trim() && `TikTok: ${tiktokHandle.trim()}`,
    ]
      .filter(Boolean)
      .join(" • ");

    toast.success("Thanks! We'll tailor editing suggestions around your socials.", {
      description: summary || "No handles shared yet.",
    });
    handleDialogChange(false);
  };

  const hasAnyHandle =
    instagramHandle.trim().length > 0 || tiktokHandle.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-3 text-xs font-medium"
          title="Connect Social Profile"
        >
          Connect Social Profile
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md border border-border/60 bg-surface-elevated/95 shadow-soft backdrop-blur">
        <DialogHeader>
          <DialogTitle>Connect your social profile</DialogTitle>
          <DialogDescription>
            Add your Instagram and TikTok handles. We’ll analyze your posted videos
            to learn pacing, transitions, and stylistic patterns so edits align with
            your brand.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SocialHandleField
            id="instagram-handle"
            label="Instagram Handle"
            icon={<InstagramIcon className="h-4 w-4 text-[#E1306C]" />}
            placeholder="@yourusername"
            value={instagramHandle}
            onChange={(event) => setInstagramHandle(event.target.value)}
            autoFocus
          />
          <SocialHandleField
            id="tiktok-handle"
            label="TikTok Handle"
            icon={<TikTokIcon className="h-4 w-4 text-foreground" />}
            placeholder="@yourusername"
            value={tiktokHandle}
            onChange={(event) => setTiktokHandle(event.target.value)}
          />
        </div>

        <DialogFooter className="pt-4">
          <Button variant="ghost" onClick={() => handleDialogChange(false)}>
            Skip for now
          </Button>
          <Button onClick={handleSubmit} disabled={!hasAnyHandle}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SocialHandleFieldProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}

function SocialHandleField({
  id,
  label,
  icon,
  placeholder,
  value,
  onChange,
  autoFocus,
}: SocialHandleFieldProps) {
  return (
    <div className="space-y-2">
      <Label
        htmlFor={id}
        className="flex items-center gap-2 text-sm font-medium text-foreground"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-muted/80">
          {icon}
        </span>
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="bg-surface-base/70"
      />
    </div>
  );
}

function InstagramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" role="img" {...props}>
      <rect
        x={3}
        y={3}
        width={18}
        height={18}
        rx={5}
        className="fill-none stroke-current"
        strokeWidth={1.6}
      />
      <circle
        cx={12}
        cy={12}
        r={3.6}
        className="fill-none stroke-current"
        strokeWidth={1.6}
      />
      <circle cx={17} cy={7} r={1.1} className="fill-current" />
    </svg>
  );
}

function TikTokIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" role="img" {...props}>
      <path
        className="fill-current"
        d="M15 3h2.4c.15 1.48 1.36 2.65 2.8 2.74V8.2a4.9 4.9 0 0 1-2.9-.97v6.14a4.87 4.87 0 1 1-4.87-4.87c.23 0 .46.02.68.06v2.55a2.38 2.38 0 1 0 2.05 2.35V3z"
      />
    </svg>
  );
}
