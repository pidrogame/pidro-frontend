export const PidroColors = {
  feltTop: '#176ea7',
  feltMid: '#0d5087',
  feltBottom: '#07264c',
  screenScrim: 'rgba(2, 21, 42, 0.3)',
  panel: 'rgba(7, 45, 82, 0.82)',
  panelStrong: 'rgba(5, 36, 69, 0.96)',
  panelSoft: 'rgba(18, 74, 119, 0.58)',
  glass: 'rgba(20, 65, 115, 0.62)',
  glassHover: 'rgba(25, 80, 140, 0.76)',
  switchTrackOff: '#416d85',
  backdrop: 'rgba(1, 13, 27, 0.72)',
  cyan: '#46dcff',
  cyanText: '#8beaff',
  cyanStatus: '#A6EEFF',
  cyanSoft: 'rgba(70, 220, 255, 0.42)',
  iconOnGlass: '#CFEFFF',
  cyanBorder: 'rgba(91, 221, 255, 0.42)',
  cyanBorderStrong: 'rgba(91, 221, 255, 0.68)',
  gold: '#e1ad3a',
  goldLight: '#f1d078',
  goldDark: '#a86b17',
  goldSoft: 'rgba(225, 173, 58, 0.18)',
  actionPrimary: '#6f3d16',
  actionPrimaryPressed: '#82501f',
  actionPrimaryBorder: '#c38725',
  woodTop: '#8a6030',
  woodMid: '#5a3515',
  woodBottom: '#1e0e04',
  text: '#ffffff',
  textOnWood: '#FFF1CF',
  textSoft: 'rgba(239, 249, 255, 0.78)',
  textMuted: 'rgba(218, 237, 247, 0.58)',
  ink: '#08243d',
  border: 'rgba(184, 225, 246, 0.22)',
  borderStrong: 'rgba(213, 239, 252, 0.38)',
  danger: '#ff9b9b',
  dangerText: '#ffe3e3',
  dangerBg: 'rgba(112, 24, 32, 0.58)',
  dangerBorder: 'rgba(255, 138, 145, 0.58)',
  success: '#92e6b2',
  successBg: 'rgba(21, 101, 63, 0.68)',
  warning: '#ffd98a',
  warningBg: 'rgba(107, 73, 11, 0.72)',
  // The turn light at the table: light, never gold (gold means a supporter).
  turnLight: '#c9f7ff',
  turnLightTrack: 'rgba(139, 234, 255, 0.22)',
  turnLightGlow: 'rgba(139, 234, 255, 0.35)',
  turnUrgent: '#ffb86b',
  turnUrgentTrack: 'rgba(255, 184, 107, 0.22)',
  turnUrgentGlow: 'rgba(255, 184, 107, 0.4)',
  // The shine behind the player on turn, drawn as a soft glow around the ring.
  turnLightShine: 'rgba(139, 234, 255, 0.6)',
  turnUrgentShine: 'rgba(255, 184, 107, 0.65)',
  // Trick signals: the "on the table" chip and the shadow under a "+N" pop.
  trickChipBg: 'rgba(10, 35, 64, 0.72)',
  popShadow: 'rgba(0, 0, 0, 0.6)',
  // The two teams, wherever a team is named (PID-294): periwinkle for you and
  // your partner, pink for the other two. Not green: mint and pink read as one
  // colour under deuteranopia (CIELAB 3 apart), this pair stays 32 to 46 apart
  // under deuteranopia, protanopia and tritanopia. At the table gold means a
  // supporter and cyan the turn light, so neither marks a team; mint means success.
  teamUs: '#b8c6ff',
  teamUsSoft: 'rgba(184, 198, 255, 0.32)',
  teamThem: '#ffb4b9',
  teamThemSoft: 'rgba(255, 180, 185, 0.32)',
  teamThemInk: '#3a1520',
  // The end of a hand (PID-236): the table dims under one panel, each team's
  // point cards in its own tray, our edge in our colour and quiet glass theirs.
  handScrim: 'rgba(2, 14, 28, 0.62)',
  trayOurs: 'rgba(10, 35, 64, 0.9)',
  trayTheirs: 'rgba(7, 45, 82, 0.82)',
  trayTheirsEdge: 'rgba(213, 239, 252, 0.38)',
  handAll14Glow: '0px 0px 18px rgba(255, 212, 71, 0.28)',
  theirScore: '#ffd9dc',
  scoreDownBg: 'rgba(255, 180, 185, 0.18)',
  scoreDownEdge: 'rgba(255, 180, 185, 0.6)',
  suitRedOnFelt: '#ff6f7d',
  pointCardShadow: '0px 3px 8px rgba(0,0,0,0.45)',
  // A five's solid gold ring glows a little past its edge.
  pointCardFiveGlow: '0px 0px 12px rgba(255, 212, 71, 0.55)',
  // The table seen from above on Tables and New table: an open chair, a chosen seat.
  chairOpenBorder: 'rgba(139, 234, 255, 0.75)',
  chairSubBorder: 'rgba(255, 184, 107, 0.85)',
  rulesFinnishBorder: 'rgba(139, 234, 255, 0.5)',
  rulesLouisianaBorder: 'rgba(255, 184, 107, 0.6)',
  rulesLouisianaText: '#ffcf8a',
  tabletopMark: 'rgba(190, 230, 255, 0.16)',
  choiceOn: 'rgba(107, 73, 11, 0.45)',
  radioOff: 'rgba(184, 225, 246, 0.6)',
  // A seat row on New table: the host's row sits darker, the gold "vs" fades in from each side.
  seatRowHost: 'rgba(7, 45, 82, 0.5)',
  seatRowChevron: 'rgba(184, 225, 246, 0.75)',
  vsLineGradient: 'linear-gradient(90deg, rgba(226,175,69,0) 0%, rgba(226,175,69,0.7) 100%)',
  plaqueShadow: '0px 4px 14px rgba(1,13,27,0.35), inset 0px 1px 0px rgba(139,234,255,0.12)',
  // A chosen row in a list of choices: gold edge on a warm wash.
  chosenBg: 'rgba(107, 73, 11, 0.45)',
  // The small league cards: a playing card's paper, ink and red suits.
  leagueCardFace: '#fbfbf7',
  leagueCardInk: '#1b1b1b',
  leagueCardRed: '#c3172f',
  leagueCardEdge: 'rgba(0, 0, 0, 0.3)',
  // Row controls (PID-241): the light action pill, its gold answer, the red count.
  actionPill: 'rgba(139, 234, 255, 0.12)',
  actionPillPressed: 'rgba(139, 234, 255, 0.22)',
  actionPillBorder: 'rgba(139, 234, 255, 0.5)',
  actionPillGold: 'rgba(226, 175, 69, 0.2)',
  actionPillGoldPressed: 'rgba(226, 175, 69, 0.32)',
  countBadge: '#d9412f',
  // The password keypad (PID-259): carved digit boxes, the next one ringed gold, a wrong try warm.
  digitBox: '#08243d',
  digitBoxBorder: 'rgba(184, 225, 246, 0.28)',
  digitBoxFilled: 'rgba(139, 234, 255, 0.7)',
  digitBoxWrong: 'rgba(255, 207, 138, 0.85)',
  digitBoxNextRing: '0px 0px 0px 3px rgba(226, 175, 69, 0.22)',
  keypadNotice: '#ffcf8a',
  focusRing: '0px 0px 0px 3px rgba(139,234,255,0.8)',
  // Friends (PID-242): the presence dot, a request row, a sent one, and the
  // floating notice card with its edges.
  presenceOnline: '#4fd37a',
  friendAskBg: 'rgba(107, 73, 11, 0.4)',
  friendAskBorder: 'rgba(226, 175, 69, 0.8)',
  friendSentBg: 'rgba(7, 45, 82, 0.6)',
  noticeFace: '#0b2c4f',
  noticeCyanBorder: 'rgba(91, 221, 255, 0.55)',
  noticeQuietBorder: 'rgba(184, 225, 246, 0.35)',
  noticeShadow: '0px 12px 28px rgba(0, 0, 0, 0.55)',
} as const;

/**
 * DS v2 bevel palette — the four-layer construction shared by wood and glass
 * controls (rim → keyline → face → gloss). Gradients are CSS strings consumed
 * through gradientBg() in components/ui/Bevel.tsx; shadows are RN boxShadow
 * strings (inset entries need the New Architecture).
 */
export const PidroBevel = {
  rimHi: '#F6DE9A',
  rim: '#E2AF45',
  rimLo: '#C4892A',
  rimDeep: '#8F5E12',
  textGold: '#FFD447',
  woodHi: '#B57A31',
  wood: '#91541C',
  woodLo: '#6C370E',
  woodDeep: '#4E2509',
  keyline: '#2A1505',
  panelHi: '#175086',
  panelMid: '#0E3158',
  panelDeep: '#0A2340',
  goldRimGradient: 'linear-gradient(180deg, #F6DE9A 0%, #E2AF45 35%, #C4892A 65%, #8F5E12 100%)',
  woodFaceGradient: 'linear-gradient(180deg, #B57A31 0%, #91541C 42%, #6C370E 78%, #4E2509 100%)',
  glassRimGradient:
    'linear-gradient(180deg, rgba(170,235,255,0.72) 0%, rgba(60,140,190,0.55) 50%, rgba(16,72,112,0.68) 100%)',
  // The avatar's free-player ring: opaque, unlike the button rim above.
  avatarGlassRingGradient:
    'linear-gradient(180deg, #D8F6FF 0%, #86CFEE 32%, #3A8BC0 66%, #17507E 100%)',
  avatarGlassEdge: '#86CFEE',
  avatarGemGradient: 'linear-gradient(135deg, #ffffff 0%, #c9f7ff 30%, #5fd2ff 65%, #2a76d0 100%)',
  avatarGemGlow: 'rgba(160, 240, 255, 0.85)',
  // The felt of a table drawn from above, ringed in wood and a gold hairline.
  tabletopGradient: 'radial-gradient(ellipse at 50% 40%, #1b6aa4 0%, #11558c 55%, #0b3f6c 100%)',
  tabletopShadow:
    '0px 0px 0px 2px #E2AF45, 0px 14px 30px rgba(1,13,27,0.55), inset 0px 0px 30px rgba(0,0,0,0.35)',
  glassFaceGradient: 'linear-gradient(180deg, rgba(46,118,178,0.92) 0%, rgba(24,78,128,0.92) 100%)',
  woodGlossGradient:
    'linear-gradient(180deg, rgba(255,248,225,0.24) 0%, rgba(255,248,225,0.07) 100%)',
  glassGlossGradient:
    'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.02) 100%)',
  dropShadow: '0px 4px 8px rgba(0,0,0,0.38), 0px 1px 2px rgba(0,0,0,0.25)',
  dropShadowPressed: '0px 2px 4px rgba(0,0,0,0.34)',
  glassDropShadow: '0px 2px 6px rgba(0,0,0,0.3)',
  glassDropShadowPressed: '0px 1px 3px rgba(0,0,0,0.28)',
  woodFaceInset: 'inset 0px 1px 0px rgba(255,230,180,0.3), inset 0px -2px 0px rgba(0,0,0,0.3)',
  woodFaceInsetPressed:
    'inset 0px 1px 0px rgba(255,230,180,0.2), inset 0px -1px 0px rgba(0,0,0,0.26)',
  glassFaceInset: 'inset 0px 1px 0px rgba(255,255,255,0.30), inset 0px -2px 0px rgba(2,24,44,0.45)',
  glassFaceInsetPressed:
    'inset 0px 1px 0px rgba(255,255,255,0.18), inset 0px -1px 0px rgba(2,24,44,0.4)',
  heroDropShadow: '0px 8px 16px rgba(0,0,0,0.5), 0px 2px 4px rgba(0,0,0,0.35)',
  heroDropShadowPressed: '0px 3px 7px rgba(0,0,0,0.45)',
  heroFaceInset: 'inset 0px 2px 0px rgba(255,240,200,0.4), inset 0px -6px 0px rgba(0,0,0,0.34)',
  heroFaceInsetPressed:
    'inset 0px 2px 0px rgba(255,240,200,0.26), inset 0px -3px 0px rgba(0,0,0,0.3)',
  heroGlossGradient:
    'linear-gradient(180deg, rgba(255,248,225,0.3) 0%, rgba(255,248,225,0.08) 100%)',
  labelShadow: {
    textShadowColor: 'rgba(20, 8, 0, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  // Names and status sit on the felt with no plate behind them.
  feltLabelShadow: {
    textShadowColor: 'rgba(0, 12, 24, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  glassLabelShadow: {
    textShadowColor: 'rgba(0, 10, 20, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
} as const;

/**
 * Game over (PID-237): the win's light and paper, the race line, the chips.
 * Celebration may go loud, but only from here.
 */
export const PidroGameOver = {
  // Opaque felt: the table is over, nothing of it should compete.
  backdrop: '#07264c',
  backdropGradient: 'radial-gradient(ellipse at 50% 30%, #0d5087 0%, #0a3a6a 45%, #041a33 100%)',
  ray: '#FFD447',
  rayOpacity: 0.17,
  spot: '#FFE28C',
  spotOpacity: 0.5,
  heroCardShadow:
    '0px 0px 0px 3px #FFD447, 0px 0px 40px rgba(255,212,71,0.85), 0px 18px 36px rgba(0,0,0,0.55)',
  bestCardShadow: '0px 0px 0px 2px #FFD447, 0px 4px 10px rgba(0,0,0,0.5)',
  sideCardShadow: '0px 8px 18px rgba(0,0,0,0.5)',
  sheenGradient:
    'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,250,220,0.85) 45%, rgba(255,215,120,0.5) 55%, rgba(255,255,255,0) 100%)',
  pidroInk: '#8F5E12',
  theirsScore: '#ffd9dc',
  target: '#E2AF45',
  markerFill: '#ffffff',
  markerEdge: '#0A2340',
  chartFace: 'rgba(5, 30, 58, 0.72)',
  chipFace: 'rgba(7, 45, 82, 0.9)',
  chipEdge: 'rgba(226, 175, 69, 0.75)',
  bestEdge: 'rgba(226, 175, 69, 0.8)',
  // A seat that has not agreed yet: solid, but greyed under a navy veil.
  waitingVeil: 'rgba(10, 35, 64, 0.62)',
  scoreGlow: {
    textShadowColor: 'rgba(78, 37, 9, 0.9)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
} as const;

/** Inset switches: quiet glass, never the wood/gold primary-action treatment. */
export const PidroSwitchTokens = {
  width: 64,
  height: 32,
  thumbSize: 24,
  inset: 4,
  offGradient: 'linear-gradient(180deg, #08243d 0%, #163f63 100%)',
  onGradient: 'linear-gradient(180deg, #23769c 0%, #389fc2 100%)',
  thumbGradient: 'linear-gradient(180deg, #e4f6ff 0%, #9ac9e4 100%)',
  trackShadow: 'inset 0px 2px 4px rgba(0,0,0,0.42), 0px 1px 0px rgba(255,255,255,0.12)',
  thumbShadow: 'inset 0px 1px 0px rgba(255,255,255,0.75), 0px 2px 3px rgba(0,0,0,0.4)',
  focusShadow: '0px 0px 0px 3px rgba(139,234,255,0.8)',
  disabledOpacity: 0.45,
} as const;

/** The rule sets' flags keep their own colours; nothing else may use these. */
export const PidroFlagColors = {
  field: '#ffffff',
  ostrobothnianField: '#d21034',
  ostrobothnianCross: '#ffce00',
  usStripe: '#b8293a',
  usCanton: '#2b3a7a',
} as const;

/**
 * The bot crew's faces (Marcel, Antti, Jocke): skin, hair and props. The
 * table's own navy, gold, cream and card red do the rest; nothing else may
 * use these.
 */
export const PidroPersonaColors = {
  skin: '#F3C9A3',
  skinShade: '#DDA27C',
  steam: 'rgba(255, 255, 255, 0.75)',
  // After the photos (2026-10-17): Marcel's trucker cap and navy jacket,
  // Antti's black beanie, red scarf and full ginger beard, Jocke's long wavy
  // hair, round glasses and waistcoat.
  capFront: '#F4F1EA',
  capNavy: '#1E2E4A',
  capBrim: '#C9443A',
  hairLight: '#8A6440',
  stubble: 'rgba(122, 86, 52, 0.4)',
  ginger: '#C2703C',
  gingerDeep: '#9E5527',
  beanie: '#1B1E24',
  beanieRib: '#2C313B',
  scarf: '#D3222E',
  jacketDark: '#23272F',
  navy: '#1F2F4D',
  waistcoat: '#7A5A3C',
  shirtDark: '#2A2F38',
  hairWavy: '#6E4A2E',
  glassTint: 'rgba(255, 255, 255, 0.14)',
} as const;

export const PidroRadii = {
  tight: 6,
  surface: 8,
  panel: 10,
  lg: 12,
  xl: 16,
  full: 999,
} as const;

export const PidroFonts = {
  ui: 'Nunito',
  display: 'BreeSerif',
} as const;

export const PidroType = {
  score: {
    fontFamily: PidroFonts.ui,
    fontSize: 56,
    lineHeight: 64,
    fontWeight: '900' as const,
    fontVariant: ['tabular-nums'] as ['tabular-nums'],
  },
  display: {
    fontFamily: PidroFonts.ui,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900' as const,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: PidroFonts.ui,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800' as const,
    letterSpacing: -0.25,
  },
  label: {
    fontFamily: PidroFonts.ui,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800' as const,
    letterSpacing: 0.1,
  },
  body: {
    fontFamily: PidroFonts.ui,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500' as const,
    letterSpacing: 0,
  },
  metadata: {
    fontFamily: PidroFonts.ui,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  /** A section's name above its rows: Your team, Fill it now, Online now. */
  eyebrow: {
    fontFamily: PidroFonts.ui,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  labelSpacing: 0.1,
} as const;

export const PidroSpacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const PidroLayout = {
  touchTarget: 44,
  contentMaxWidth: 520,
  wideContentMaxWidth: 880,
  compactHeight: 500,
  landscapeMinWidth: 640,
} as const;
