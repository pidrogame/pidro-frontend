import { Linking, StyleSheet } from 'react-native';
import { PidroText, type PidroTextProps } from '@/components/ui/PidroText';
import { PidroColors } from '@/design/tokens';
import { parseNewsMarkdown } from '@/features/newsPopup';

/** No HTML, images, headings or native Markdown dependency. */
export function NewsMarkdown({
  body,
  onLinkError,
  style,
  ...props
}: PidroTextProps & {
  body: string;
  onLinkError?: () => void;
}) {
  return (
    <PidroText {...props} style={style}>
      {parseNewsMarkdown(body).map((part, index) => (
        <PidroText
          key={index}
          tone={props.tone}
          style={[style, part.bold && styles.bold, part.url && styles.link]}
          accessibilityRole={part.url ? 'link' : undefined}
          onPress={
            part.url
              ? () => void Linking.openURL(part.url!).catch(() => onLinkError?.())
              : undefined
          }>
          {part.text}
        </PidroText>
      ))}
    </PidroText>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '900', color: PidroColors.text },
  link: { color: PidroColors.cyanText, textDecorationLine: 'underline' },
});
