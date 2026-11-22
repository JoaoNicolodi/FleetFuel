import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import type { PhotoReader } from '../sync/types';

const PHOTO_DIR = `${FileSystem.documentDirectory}odometer/`;

/**
 * Comprime a foto do hodômetro (1024 px, JPEG 60%) e move para a pasta
 * permanente do app. O cache da câmera pode ser limpo pelo sistema — se a foto
 * ficasse lá, um abastecimento offline poderia perder a prova antes de sincronizar.
 */
export async function persistOdometerPhoto(cameraUri: string, clientId: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => undefined);
  const small = await ImageManipulator.manipulateAsync(cameraUri, [{ resize: { width: 1024 } }], {
    compress: 0.6,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const dest = `${PHOTO_DIR}${clientId}.jpg`;
  await FileSystem.moveAsync({ from: small.uri, to: dest });
  return dest;
}

export const filePhotoReader: PhotoReader = {
  async readBase64(uri: string) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    } catch {
      return null;
    }
  },
};

/** Posição atual com fallback para a última conhecida (GPS pode demorar dentro do posto). */
export async function currentPosition(): Promise<{ lat: number; lng: number; speedKmh: number | null } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return null;
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 6000)),
    ]);
    const p = pos ?? (await Location.getLastKnownPositionAsync());
    if (!p) return null;
    return { lat: p.coords.latitude, lng: p.coords.longitude, speedKmh: p.coords.speed !== null && p.coords.speed >= 0 ? p.coords.speed * 3.6 : null };
  } catch {
    return null;
  }
}

export async function watchPosition(cb: (p: { lat: number; lng: number; speedKmh: number | null }) => void) {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return null;
  return Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 50 }, (p) =>
    cb({ lat: p.coords.latitude, lng: p.coords.longitude, speedKmh: p.coords.speed !== null && p.coords.speed >= 0 ? p.coords.speed * 3.6 : null }),
  );
}

/** Feedback háptico: o motorista sente no celular se deu certo (útil com luva / sol forte). */
export const haptic = {
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
};
