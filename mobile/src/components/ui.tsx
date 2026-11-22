import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const colors = {
  bg: '#f4f6f9',
  surface: '#ffffff',
  text: '#1c2430',
  muted: '#6b7686',
  line: '#e3e7ee',
  brand: '#0f6e5a',
  brandSoft: '#e3f3ef',
  ok: '#1f8a4c',
  warn: '#b7791f',
  bad: '#c0392b',
};

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[s.input, error ? { borderColor: colors.bad } : null]} {...props} />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export function Button({ title, onPress, disabled, loading, variant = 'primary' }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'ghost' | 'danger' }) {
  const bg = variant === 'primary' ? colors.brand : variant === 'danger' ? colors.bad : colors.brandSoft;
  const fg = variant === 'ghost' ? colors.brand : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function ConnectionBanner({ online, syncing, pending }: { online: boolean; syncing: boolean; pending: number }) {
  const bg = online ? (syncing ? colors.brandSoft : '#e5f5ec') : '#fff4e5';
  const text = !online
    ? `📴 Sem sinal — modo offline${pending ? ` · ${pending} na fila` : ''}`
    : syncing
      ? '🔄 Sincronizando…'
      : pending
        ? `🟡 ${pending} aguardando envio`
        : '🟢 Online · tudo sincronizado';
  return (
    <View style={[s.banner, { backgroundColor: bg }]}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12, color: colors.text },
  label: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, fontSize: 16, color: colors.text, backgroundColor: '#fff' },
  error: { color: colors.bad, fontSize: 12, marginTop: 4 },
  btn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  btnText: { fontSize: 16, fontWeight: '700' },
  banner: { paddingVertical: 8, paddingHorizontal: 16 },
  muted: { color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
