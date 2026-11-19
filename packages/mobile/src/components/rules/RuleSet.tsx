import type { RuleSet } from '@pidro/shared';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';
import {
  PidroColors,
  PidroFlagColors,
  PidroLayout,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import { ruleSets } from '@/features/rules/ruleSets';
import { t, useTranslation } from '@/i18n';

export function ruleSetLabel(ruleSet: RuleSet) {
  return t(ruleSets[ruleSet].labelKey);
}

/** Louisiana's fleur-de-lis: the middle petal, the curled side petals, the band and the feet. */
const FLEUR_DE_LIS = [
  'M9 0.8C10.9 2.4 11 5 9.9 7H8.1C7 5 7.1 2.4 9 0.8Z',
  'M8.2 7C7.9 4.9 6.2 3.6 4.6 4.1C3.4 4.5 3.5 6.3 4.9 6.4C5.6 6.4 5.9 5.8 5.6 5.3C6.7 5.3 7.3 6.1 7.4 7Z',
  'M9.8 7C10.1 4.9 11.8 3.6 13.4 4.1C14.6 4.5 14.5 6.3 13.1 6.4C12.4 6.4 12.1 5.8 12.4 5.3C11.3 5.3 10.7 6.1 10.6 7Z',
  'M6.2 7h5.6v1.3H6.2Z',
  'M8.4 8.2H9.6L9.3 11.1H8.7Z',
  'M8.3 8.2C7.2 8.5 6.3 9.3 6.3 10.5C6.3 10.9 6.8 11 7 10.6C7.3 9.8 7.8 9.2 8.6 8.9Z',
  'M9.7 8.2C10.8 8.5 11.7 9.3 11.7 10.5C11.7 10.9 11.2 11 11 10.6C10.7 9.8 10.2 9.2 9.4 8.9Z',
];

/**
 * The rule set's flag, drawn rather than an emoji: emoji flags render as two
 * letters on some Android phones and never match the bevel look.
 */
export function RuleSetFlag({ ruleSet, height = 12 }: { ruleSet: RuleSet; height?: number }) {
  if (ruleSet === 'finnish') {
    // Finland's Nordic cross on 18×11: arms 3 wide, the upright left of centre.
    return (
      <Svg width={(height * 18) / 11} height={height} viewBox="0 0 18 11">
        <Rect width={18} height={11} rx={1.5} fill={PidroFlagColors.finnishField} />
        <Path d="M5 0h3v11H5zM0 4h18v3H0z" fill={PidroFlagColors.finnishCross} />
        <Rect
          x={0.3}
          y={0.3}
          width={17.4}
          height={10.4}
          rx={1.2}
          fill="none"
          stroke={PidroFlagColors.finnishEdge}
          strokeWidth={0.6}
        />
      </Svg>
    );
  }
  return (
    <Svg width={height * 1.5} height={height} viewBox="0 0 18 12">
      <Rect width={18} height={12} rx={1.5} fill={PidroFlagColors.louisianaField} />
      {FLEUR_DE_LIS.map((d) => (
        <Path key={d} d={d} fill={PidroColors.goldLight} />
      ))}
    </Svg>
  );
}

export function RuleSetChip({
  ruleSet,
  testID,
  flagOnly = false,
  compact = false,
  onPress,
  style,
}: {
  ruleSet: RuleSet;
  testID?: string;
  flagOnly?: boolean;
  compact?: boolean;
  /** A tap on the flag opens the rules; the padding round the chip makes the 44pt target. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const color = ruleSet === 'finnish' ? PidroColors.cyanText : PidroColors.rulesLouisianaText;
  const chip = (
    <Surface
      variant="subtle"
      style={[
        styles.chip,
        compact && styles.compactChip,
        compact && {
          borderColor:
            ruleSet === 'finnish'
              ? PidroColors.rulesFinnishBorder
              : PidroColors.rulesLouisianaBorder,
        },
        !onPress && style,
      ]}
      testID={onPress ? undefined : testID}
      accessibilityLabel={onPress ? undefined : ruleSetLabel(ruleSet)}>
      <RuleSetFlag ruleSet={ruleSet} />
      {flagOnly ? null : (
        <PidroText role="metadata" style={compact && [styles.compactText, { color }]}>
          {ruleSetLabel(ruleSet)}
        </PidroText>
      )}
    </Surface>
  );
  return onPress ? (
    <PressableFX
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t(ruleSets[ruleSet].longKey)}
      onPress={onPress}
      style={[styles.target, flagOnly && styles.flagTarget, style]}>
      {chip}
    </PressableFX>
  ) : (
    chip
  );
}

export function RuleSetSelector<T extends RuleSet | 'all'>({
  value,
  onChange,
  includeAll = false,
  disabled = false,
}: {
  value: T;
  onChange: (value: T) => void;
  includeAll?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const options: (RuleSet | 'all')[] = includeAll
    ? ['all', ...(Object.keys(ruleSets) as RuleSet[])]
    : (Object.keys(ruleSets) as RuleSet[]);
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <BevelButton
          key={option}
          label={option === 'all' ? t('rules.all') : ruleSetLabel(option)}
          leadingIcon={option === 'all' ? undefined : <RuleSetFlag ruleSet={option} />}
          material={value === option ? 'wood' : 'glass'}
          size="sm"
          disabled={disabled}
          accessibilityState={{ selected: value === option }}
          aria-selected={value === option}
          onPress={() => onChange(option as T)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  target: {
    alignSelf: 'flex-start',
    minWidth: PidroLayout.touchTarget,
    minHeight: PidroLayout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A flag alone (36×22) keeps its own footprint; its target reaches past it into the margin.
  flagTarget: { marginHorizontal: -4, marginVertical: -11 },
  compactChip: {
    height: 22,
    paddingVertical: 0,
    justifyContent: 'center',
    borderRadius: PidroRadii.full,
    backgroundColor: 'transparent',
  },
  compactText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: PidroSpacing.xxs },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xxs,
    paddingHorizontal: PidroSpacing.xs,
    paddingVertical: PidroSpacing.xxs,
  },
});
