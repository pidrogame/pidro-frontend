import { PidroColors } from '@/design/tokens';

/** Canvas-friendly aliases of the mobile design system. */
export const T = {
  feltCenter: '#1e5a8a',
  feltMid: PidroColors.feltMid,
  feltEdge: PidroColors.feltBottom,
  bgDeep: PidroColors.panelStrong,

  cyan: PidroColors.cyan,
  cyanText: PidroColors.cyanText,
  cyanSoft: PidroColors.cyanSoft,
  cyanGlow: 'rgba(0, 207, 255, 0.35)',
  gold: PidroColors.gold,
  goldLight: PidroColors.goldLight,
  green: PidroColors.success,

  cardFrame: '#fcfcfc',
  glassBg: PidroColors.glass,
  glassBorder: PidroColors.cyanBorder,

  // Table-derived
  ringDot: 'rgba(70, 220, 255, 0.28)',
  slot: 'rgba(255, 255, 255, 0.08)',
  slotYou: 'rgba(70, 220, 255, 0.16)',
  slotStroke: 'rgba(0, 200, 255, 0.35)',
  seatDot: 'rgba(255, 255, 255, 0.35)',
  turn: PidroColors.gold,

  textPrimary: PidroColors.text,
  textSecondary: PidroColors.textSoft,
} as const;
