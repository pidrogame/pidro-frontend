/**
 * Classic's table sounds (PID-335): its own files at volume 1.0. Each file
 * loads once into its own player, so one sound never cuts off another; a
 * sound played again restarts itself. The silent switch is respected and
 * other apps' audio keeps playing. On web nothing plays before the page's
 * first tap or key: a browser refuses it, and expo-audio leaves that refusal
 * unhandled (PID-344).
 */
import { AppState, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useSettingsStore } from '@/stores/settings';
import { pageMayPlay, shuffleCovered } from '@/features/game/sounds';

const FILES = {
  card: require('~/assets/sounds/card-play.wav'),
  shuffle: require('~/assets/sounds/shuffle.wav'),
  deal: require('~/assets/sounds/deal.wav'),
  turn: require('~/assets/sounds/your-turn.wav'),
  reminder: require('~/assets/sounds/your-turn-reminder.wav'),
  bid: require('~/assets/sounds/bid.wav'),
  pass: require('~/assets/sounds/pass.wav'),
  won: require('~/assets/sounds/game-won.wav'),
  lost: require('~/assets/sounds/game-lost.wav'),
} as const;
export type SoundName = keyof typeof FILES;

let players: Partial<Record<SoundName, AudioPlayer>> | null = null;
let shuffledAt = -Infinity;
let gestured = false;
const web = Platform.OS === 'web' && typeof window !== 'undefined';
if (web && !navigator.userActivation) {
  const gesture = () => (gestured = true);
  window.addEventListener('pointerdown', gesture, { capture: true, once: true });
  window.addEventListener('keydown', gesture, { capture: true, once: true });
}

/** Loads every player once; the table calls it early, like the card textures. */
export function preloadSounds() {
  if (players) return;
  players = {};
  try {
    void setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
    }).catch(() => {});
    for (const name of Object.keys(FILES) as SoundName[]) {
      players[name] = createAudioPlayer(FILES[name]);
    }
  } catch {
    // Sound is polish: a player that will not load stays silent.
  }
}

export function play(name: SoundName) {
  if (!useSettingsStore.getState().soundEnabled || AppState.currentState !== 'active') return;
  if (web && !pageMayPlay(navigator.userActivation, gestured)) return;
  preloadSounds();
  const player = players?.[name];
  if (!player) return;
  if (name === 'shuffle') {
    if (shuffleCovered(shuffledAt, Date.now())) return;
    shuffledAt = Date.now();
  }
  try {
    void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    return;
  }
  if (__DEV__) console.log(`[Sound] ${name}`);
}
