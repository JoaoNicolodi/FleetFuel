import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, colors } from '../components/ui';
import { haptic } from '../services/device';

/**
 * Captura da foto do hodômetro (recurso nativo: câmera).
 * Uma moldura guia o motorista a enquadrar o painel para o gestor conseguir ler o número.
 */
export function CameraScreen({ visible, onClose, onCaptured }: { visible: boolean; onClose: () => void; onCaptured: (uri: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);

  const take = async () => {
    if (!ref.current || busy) return;
    setBusy(true);
    try {
      const photo = await ref.current.takePictureAsync({ quality: 0.7, skipProcessing: false });
      if (photo?.uri) {
        haptic.success();
        onCaptured(photo.uri);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {!permission ? (
        <View style={st.center} />
      ) : !permission.granted ? (
        <View style={st.center}>
          <Text style={st.msg}>Precisamos da câmera para fotografar o hodômetro.</Text>
          <Button title="Permitir câmera" onPress={requestPermission} />
          <Button title="Cancelar" variant="ghost" onPress={onClose} />
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={ref} style={{ flex: 1 }} facing="back" enableTorch={torch} />
          <View pointerEvents="none" style={st.overlay}>
            <View style={st.frame} />
            <Text style={st.hint}>Enquadre o hodômetro dentro da moldura</Text>
          </View>
          <View style={st.controls}>
            <Pressable onPress={onClose}><Text style={st.ctrl}>Cancelar</Text></Pressable>
            <Pressable onPress={take} disabled={busy} style={[st.shutter, busy && { opacity: 0.5 }]} accessibilityLabel="Tirar foto" />
            <Pressable onPress={() => setTorch((t) => !t)}><Text style={st.ctrl}>{torch ? '🔦 On' : '🔦 Off'}</Text></Pressable>
          </View>
        </View>
      )}
    </Modal>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  msg: { fontSize: 16, textAlign: 'center', marginBottom: 16, color: colors.text },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  frame: { width: '80%', height: 140, borderWidth: 3, borderColor: '#ffffffcc', borderRadius: 12 },
  hint: { color: '#fff', marginTop: 12, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4 },
  controls: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  ctrl: { color: '#fff', fontSize: 16, fontWeight: '600' },
  shutter: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#fff', borderWidth: 5, borderColor: '#ffffff88' },
});
