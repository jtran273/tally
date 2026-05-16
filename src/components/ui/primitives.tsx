"use client";

import Link, { type LinkProps } from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode
} from "react";
import styles from "./primitives.module.css";

type ButtonTone = "primary" | "secondary" | "danger" | "ghost";
type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";
type NoticeTone = "neutral" | "success" | "warning" | "error" | "info";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function buttonToneClass(tone: ButtonTone) {
  if (tone === "primary") return styles.primary;
  if (tone === "danger") return styles.danger;
  if (tone === "ghost") return styles.ghost;
  return styles.secondary;
}

function badgeToneClass(tone: BadgeTone) {
  if (tone === "success") return styles.badgeSuccess;
  if (tone === "warning") return styles.badgeWarning;
  if (tone === "danger") return styles.badgeDanger;
  if (tone === "info") return styles.badgeInfo;
  return "";
}

function noticeToneClass(tone: NoticeTone) {
  if (tone === "success") return styles.noticeSuccess;
  if (tone === "warning") return styles.noticeWarning;
  if (tone === "error") return styles.noticeError;
  if (tone === "info") return styles.noticeInfo;
  return "";
}

export function Button({
  className,
  tone = "secondary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      className={cx(styles.button, buttonToneClass(tone), className)}
      type={type}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  tone = "secondary",
  ...props
}: LinkProps & AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: ButtonTone }) {
  return (
    <Link
      className={cx(styles.button, buttonToneClass(tone), className)}
      {...props}
    />
  );
}

export function Panel({
  className,
  padded = false,
  ...props
}: HTMLAttributes<HTMLElement> & { padded?: boolean }) {
  return (
    <section
      className={cx(styles.panel, padded && styles.panelPadded, className)}
      {...props}
    />
  );
}

export function PanelHeader({
  actions,
  children,
  className
}: HTMLAttributes<HTMLDivElement> & { actions?: ReactNode }) {
  return (
    <div className={cx(styles.panelHeader, className)}>
      <div className={styles.sectionHeading}>{children}</div>
      {actions}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  subtitle,
  title
}: {
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className={styles.sectionHeading}>
      {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
      <h2 className={styles.title}>{title}</h2>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
  );
}

export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx(styles.eyebrow, className)} {...props} />;
}

export function MetricGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.metricGrid, className)} {...props} />;
}

export function MetricCard({
  detail,
  label,
  tone = "neutral",
  value
}: {
  detail?: ReactNode;
  label: ReactNode;
  tone?: "neutral" | "trusted" | "warning";
  value: ReactNode;
}) {
  const toneClass = tone === "trusted"
    ? styles.metricTrusted
    : tone === "warning"
      ? styles.metricWarning
      : "";

  return (
    <div className={cx(styles.metricCard, toneClass)}>
      <span className={styles.eyebrow}>{label}</span>
      <strong className={styles.metricValue}>{value}</strong>
      {detail ? <span className={styles.metricDetail}>{detail}</span> : null}
    </div>
  );
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cx(styles.badge, badgeToneClass(tone), className)} {...props} />;
}

export function Notice({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: NoticeTone }) {
  return <div className={cx(styles.notice, noticeToneClass(tone), className)} {...props} />;
}
