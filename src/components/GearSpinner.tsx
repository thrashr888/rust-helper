import { Gear } from "@phosphor-icons/react";

interface GearSpinnerProps {
  size?: number;
  className?: string;
}

export function GearSpinner({ size = 16, className = "" }: GearSpinnerProps) {
  return <Gear size={size} className={`gear-spinner ${className}`} />;
}
