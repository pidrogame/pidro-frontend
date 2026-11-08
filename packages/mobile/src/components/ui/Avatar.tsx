import { useState } from 'react';
import { Image, type ImageProps, type ImageSourcePropType } from 'react-native';

/** The faces a player without a photo can wear; the server's `a` and `b` (PID-395). */
export const FACES = {
  a: require('~/assets/images/avatar1.png') as ImageSourcePropType,
  b: require('~/assets/images/avatar2.png') as ImageSourcePropType,
};
const fallback = FACES.a;

type Props = Omit<ImageProps, 'source'> & {
  uri?: string | null;
  fallbackSource?: ImageSourcePropType;
};

/** An avatar that owns image load failures and always leaves a usable fallback. */
export function Avatar({ uri, fallbackSource = fallback, onError, ...props }: Props) {
  const [failedUri, setFailedUri] = useState<string | null>(null);

  return (
    <Image
      {...props}
      source={uri && failedUri !== uri ? { uri } : fallbackSource}
      onError={(event) => {
        if (uri) setFailedUri(uri);
        onError?.(event);
      }}
    />
  );
}
