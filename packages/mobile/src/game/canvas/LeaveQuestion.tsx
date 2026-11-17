import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { useTranslation } from '@/i18n';

/** "Leave table?": the settings panel asks it, and so does Android's Back (PID-458). */
export function LeaveQuestion({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <PidroText tone="soft">{t('game.leave_description')}</PidroText>
      <BevelButton material="glass" label={t('game.stay')} fullWidth onPress={onStay} />
      <BevelButton
        material="glass"
        tone="danger"
        label={t('game.leave')}
        fullWidth
        onPress={onLeave}
      />
    </>
  );
}
