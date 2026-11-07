import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { deleteAccount } from '@/api/auth';
import type { ClassicProfile } from '@/api/profile';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { BevelButton } from '@/components/ui/BevelButton';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { PidroSpacing } from '@/design/tokens';
import { unregisterPush } from '@/features/push/push';
import { useProfileIdentity } from '@/hooks/useProfileIdentity';
import { useAuthStore } from '@/stores/auth';
import { useTranslation, type TranslationKey } from '@/i18n';
import { localizedError } from '@pidro/shared';

/** The signed-in player's email, Sign out and Delete account. */
export function AccountSection() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const router = useRouter();
  const refreshIdentity = useProfileIdentity();
  const [busy, setBusy] = useState(false);
  const deleteInFlight = useRef(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [pendingSignOut, setPendingSignOut] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [classic, setClassic] = useState<ClassicProfile | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: TranslationKey;
    description: TranslationKey;
    label: TranslationKey;
    cancelLabel?: TranslationKey;
    secondaryLabel?: TranslationKey;
    secondary?: () => void;
    proceed: () => void;
  } | null>(null);

  usePreventRemove(busy, () => {
    setConfirmation({
      title: 'account.wait',
      description: 'account.deleting',
      label: 'account.ok',
      proceed: () => {},
    });
  });

  useEffect(() => {
    if (!pendingSignOut || busy) return;
    // The push token goes while the session can still say whose it is.
    void unregisterPush().finally(() => {
      clearSession();
      router.replace('/welcome');
    });
  }, [pendingSignOut, busy, clearSession, router]);

  useFocusEffect(
    useCallback(() => {
      void refreshIdentity()
        .then((identity) => {
          if (identity) setClassic(identity.classic ?? null);
        })
        .catch(() => {});
    }, [refreshIdentity])
  );

  const handleSignOut = () => {
    if (user?.guest) {
      setConfirmation({
        title: 'account.saveGuestTitle',
        description: 'account.saveGuestBody',
        label: 'account.signOutAnyway',
        cancelLabel: 'common.cancel',
        secondaryLabel: 'account.save',
        secondary: () => setAccountSheetOpen(true),
        proceed: () => setPendingSignOut(true),
      });
      return;
    }
    setConfirmation({
      title: 'account.signOutTitle',
      description: 'account.signOutBody',
      label: 'account.signOut',
      cancelLabel: 'common.cancel',
      proceed: () => setPendingSignOut(true),
    });
  };

  const handleDeleteAccount = () => {
    setDeleteError(null);
    setConfirmation({
      title: 'account.deleteTitle',
      description: classic ? 'account.deleteClassicBody' : 'account.deleteBody',
      label: 'account.delete',
      cancelLabel: 'common.cancel',
      proceed: async () => {
        if (deleteInFlight.current) return;
        deleteInFlight.current = true;
        setBusy(true);
        try {
          await deleteAccount();
          setPendingSignOut(true);
        } catch (deleteFailure) {
          setDeleteError(deleteFailure);
        } finally {
          deleteInFlight.current = false;
          setBusy(false);
        }
      },
    });
  };

  return (
    <>
      <Surface variant="window" style={styles.panel} padded testID="settings-account">
        <View style={styles.heading}>
          <PidroText role="label">{t('account.title')}</PidroText>
          <PidroText role="metadata" tone="muted">
            {user?.email ?? t(user?.guest ? 'account.guest' : 'account.signedIn')}
          </PidroText>
        </View>
        <BevelButton
          label={t('account.signOut')}
          material="glass"
          size="sm"
          fullWidth
          disabled={busy}
          onPress={handleSignOut}
        />
        <BevelButton
          label={t('account.delete')}
          material="glass"
          tone="danger"
          size="sm"
          fullWidth
          disabled={busy}
          onPress={handleDeleteAccount}
        />
        {deleteError ? (
          <PidroText role="metadata" tone="danger" align="center" accessibilityRole="alert">
            {localizedError(deleteError, 'account.deleteError')}
          </PidroText>
        ) : null}
      </Surface>
      <Modal
        isOpen={!!confirmation}
        title={confirmation ? t(confirmation.title) : undefined}
        description={confirmation ? t(confirmation.description) : undefined}
        onClose={() => setConfirmation(null)}>
        {confirmation && (
          <View className="gap-2">
            {confirmation.cancelLabel && (
              <Button
                label={t(confirmation.cancelLabel)}
                variant="outline"
                onPress={() => setConfirmation(null)}
              />
            )}
            {confirmation.secondaryLabel && confirmation.secondary ? (
              <BevelButton
                label={t(confirmation.secondaryLabel)}
                material="wood"
                size="sm"
                fullWidth
                onPress={() => {
                  const secondary = confirmation.secondary;
                  setConfirmation(null);
                  secondary?.();
                }}
              />
            ) : null}
            <Button
              label={t(confirmation.label)}
              variant={confirmation.cancelLabel ? 'destructive' : 'outline'}
              onPress={() => {
                const proceed = confirmation.proceed;
                setConfirmation(null);
                proceed();
              }}
            />
          </View>
        )}
      </Modal>
      <AuthSheet
        isOpen={accountSheetOpen}
        onClose={() => setAccountSheetOpen(false)}
        showClaimClassic={!classic}
        onClaimClassic={() => {
          setAccountSheetOpen(false);
          router.push('/(auth)/claim-classic');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  panel: { gap: PidroSpacing.sm },
  heading: { gap: PidroSpacing.xxs },
});
