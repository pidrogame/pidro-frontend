import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { AVATAR_MAX_BYTES } from '@pidro/shared';
import { profileApi } from '@/api/profile';
import { saveFace, type Face } from '@/features/profile';
import { authStore } from '@/stores/auth';
import { localizedError, localizedFieldErrors } from '@/utils/apiErrors';
import type { TranslationKey } from '@/i18n';

/** The player's photo, and the face they wear without one; guests pick faces too. */
export function useProfilePhoto() {
  const [preview, setPreview] = useState<string | null>(null);
  const [face, setFace] = useState<Face | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState<'photo' | 'face' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    cause?: unknown;
    fallback: TranslationKey;
    field?: string;
    face?: Face;
  } | null>(null);
  const locked = useRef(false);
  // A face saving holds off photo changes but, unlike them, never holds the sheet open.
  const picking = useRef(false);
  const mounted = useRef(true);
  usePreventRemove(busy, () => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), saved === 'face' ? 4000 : 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  /** With `then`, the photo goes so that face can follow it. */
  const change = async (remove = false, then?: Face) => {
    const session = authStore.getState();
    if (locked.current || picking.current) return;
    if (!session.user || session.user.guest || !session.accessToken) return;
    const { id } = session.user;
    const token = session.accessToken;
    const currentSession = () => {
      const current = authStore.getState();
      return current.user?.id === id && current.accessToken === token;
    };
    const canUpdate = () => mounted.current && currentSession();
    const updateAvatarForCurrentSession = (avatarUrl: string | null, hasPhoto: boolean) => {
      if (!currentSession()) return;
      const current = authStore.getState();
      current.setSession({
        accessToken: token,
        refreshToken: current.refreshToken ?? undefined,
        user: { ...current.user!, avatar_url: avatarUrl, has_photo: hasPhoto },
      });
    };
    locked.current = true;
    setBusy(true);
    let pickerUri: string | undefined;
    let processedUri: string | undefined;
    let fallback: TranslationKey = remove ? 'profile.remove_error' : 'profile.photo_open_error';
    try {
      if (remove) {
        setError(null);
        setSaved(null);
        const result = await profileApi.removeAvatar();
        updateAvatarForCurrentSession(result.avatar_url, false);
        return true;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      pickerUri = result.assets?.[0]?.uri;
      if (!canUpdate() || result.canceled) return;
      setError(null);
      setSaved(null);
      const asset = result.assets[0];
      if (!asset) throw new Error('No photo was returned');
      const resize = asset.width > 1024 || asset.height > 1024;
      const uri =
        Platform.OS !== 'web' || resize
          ? (
              await ImageManipulator.manipulateAsync(
                asset.uri,
                resize
                  ? [{ resize: asset.width >= asset.height ? { width: 1024 } : { height: 1024 } }]
                  : [],
                { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG }
              )
            ).uri
          : asset.uri;
      processedUri = uri;
      let file: Blob | { uri: string; name: string; type: string };
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        if (!response.ok) throw new Error('Could not read photo');
        file = await response.blob();
        if (file.size > AVATAR_MAX_BYTES) {
          if (canUpdate()) setError({ fallback: 'profile.photo_large' });
          return;
        }
      } else {
        file = { uri, name: 'avatar.jpg', type: 'image/jpeg' };
      }
      if (!canUpdate()) return;
      setPreview(uri);
      setProgress(0);
      fallback = 'profile.upload_error';
      const uploaded = await profileApi.uploadAvatar(file, (percent) => {
        if (canUpdate()) setProgress(percent);
      });
      updateAvatarForCurrentSession(uploaded.avatar_url, true);
      if (canUpdate()) setSaved('photo');
    } catch (cause) {
      if (canUpdate())
        setError({
          cause,
          fallback,
          field: fallback === 'profile.upload_error' ? 'avatar' : undefined,
          face: then,
        });
    } finally {
      if (mounted.current) {
        setPreview(null);
        setProgress(null);
        setBusy(false);
      }
      locked.current = false;
      if (Platform.OS === 'web') {
        for (const uri of new Set([pickerUri, processedUri]))
          if (uri?.startsWith('blob:')) URL.revokeObjectURL(uri);
      }
    }
  };

  const pickFace = async (next: Face) => {
    const session = authStore.getState();
    if (locked.current || picking.current || !session.user || !session.accessToken) return;
    const { id } = session.user;
    const token = session.accessToken;
    const currentSession = () => {
      const current = authStore.getState();
      return current.user?.id === id && current.accessToken === token;
    };
    picking.current = true;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await saveFace(next, {
        show: (shown) => {
          if (mounted.current) setFace(shown);
        },
        put: profileApi.setFace,
        install: (user) => {
          if (!currentSession()) return;
          const current = authStore.getState();
          current.setSession({
            accessToken: token,
            refreshToken: current.refreshToken ?? undefined,
            user: {
              ...current.user!,
              avatar_url: user.avatar_url,
              avatar_face: user.avatar_face,
              has_photo: user.has_photo,
            },
          });
        },
      });
      if (mounted.current && currentSession()) setSaved('face');
    } catch {
      // One plain line for any refusal, an older server's 404 included.
      if (mounted.current && currentSession())
        setError({ fallback: 'profile.face_error', face: next });
    } finally {
      picking.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const remove = async (then?: Face) => {
    if ((await change(true, then)) && then) await pickFace(then);
  };

  return {
    preview,
    face,
    busy,
    saving,
    progress,
    saved: saved === 'photo',
    faceSaved: saved === 'face',
    error: error
      ? ((error.field ? localizedFieldErrors(error.cause)[error.field] : undefined) ??
        localizedError(error.cause, error.fallback))
      : null,
    choose: () => change(),
    remove,
    pickFace,
    // Try again repeats what failed: the removal (and the face after it), the face, or the pick.
    retry: () =>
      error?.fallback === 'profile.remove_error'
        ? remove(error.face)
        : error?.face
          ? pickFace(error.face)
          : change(),
    isBusy: () => locked.current,
  };
}
