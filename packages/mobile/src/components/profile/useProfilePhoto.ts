import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { AVATAR_MAX_BYTES } from '@pidro/shared';
import { profileApi } from '@/api/profile';
import { authStore } from '@/stores/auth';
import { localizedError, localizedFieldErrors } from '@/utils/apiErrors';
import type { TranslationKey } from '@/i18n';

export function useProfilePhoto() {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{
    cause?: unknown;
    fallback: TranslationKey;
    field?: string;
  } | null>(null);
  const locked = useRef(false);
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
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const change = async (remove = false) => {
    const session = authStore.getState();
    if (locked.current || !session.user || session.user.guest || !session.accessToken) return;
    const { id } = session.user;
    const token = session.accessToken;
    const currentSession = () => {
      const current = authStore.getState();
      return current.user?.id === id && current.accessToken === token;
    };
    const canUpdate = () => mounted.current && currentSession();
    const updateAvatarForCurrentSession = (avatarUrl: string | null) => {
      if (!currentSession()) return;
      const current = authStore.getState();
      current.setSession({
        accessToken: token,
        refreshToken: current.refreshToken ?? undefined,
        user: { ...current.user!, avatar_url: avatarUrl },
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
        setSaved(false);
        const result = await profileApi.removeAvatar();
        updateAvatarForCurrentSession(result.avatar_url);
        return;
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
      setSaved(false);
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
      updateAvatarForCurrentSession(uploaded.avatar_url);
      if (canUpdate()) setSaved(true);
    } catch (cause) {
      if (canUpdate())
        setError({
          cause,
          fallback,
          field: fallback === 'profile.upload_error' ? 'avatar' : undefined,
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

  return {
    preview,
    busy,
    progress,
    saved,
    error: error
      ? ((error.field ? localizedFieldErrors(error.cause)[error.field] : undefined) ??
        localizedError(error.cause, error.fallback))
      : null,
    choose: () => change(),
    remove: () => change(true),
    isBusy: () => locked.current,
  };
}
