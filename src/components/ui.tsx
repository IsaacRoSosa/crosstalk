// Small building blocks shared by the landing, onboarding and example screens, following the
// Crosstalk flow prototype: black and white, JetBrains Mono, uppercase tracked labels, thin borders.
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function PulseDot({ size = 6 }: { size?: number }) {
  return <span className="ct-pulse-dot inline-block shrink-0" style={{ width: size, height: size }} aria-hidden="true" />
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50 ${className}`}>{children}</div>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

const buttonBase =
  'inline-block px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed'

// Class names, for links that look like buttons
export const primaryButtonClass = `${buttonBase} bg-white text-black hover:bg-white/85 hover:text-black disabled:bg-white/20 disabled:text-white/40`
export const ghostButtonClass = `${buttonBase} border border-white/30 bg-transparent text-white hover:border-white hover:text-white disabled:text-white/30`

export function PrimaryButton({ className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`${primaryButtonClass} ${className}`}
    />
  )
}

export function GhostButton({ className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`${ghostButtonClass} ${className}`}
    />
  )
}

// Bordered box with the prototype's faint scanlines
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative border border-white/25 bg-black ${className}`}>
      <div className="ct-scanlines absolute inset-0" />
      <div className="relative">{children}</div>
    </div>
  )
}

export function PanelHeader({ title, step }: { title: string; step?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/20 p-4">
      <PulseDot size={8} />
      <div className="text-xs font-semibold uppercase tracking-[0.1em]">{title}</div>
      {step && <div className="ml-auto text-[9px] tracking-[0.1em] text-white/40">{step}</div>}
    </div>
  )
}

// The crosstalk wordmark, linking home
export function Wordmark() {
  return (
    <a href="/" className="flex items-center gap-2.5 text-white hover:text-white">
      <PulseDot size={8} />
      <span className="text-[13px] font-bold uppercase tracking-[0.2em]">crosstalk</span>
    </a>
  )
}
