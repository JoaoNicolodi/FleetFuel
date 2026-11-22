import { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from './src/AppContext';
import { ConnectionBanner, colors } from './src/components/ui';
import { RefuelScreen } from './src/screens/RefuelScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { ShiftScreen } from './src/screens/ShiftScreen';
import { haptic } from './src/services/device';

type Tab = 'refuel' | 'queue' | 'shift';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'refuel', label: 'Abastecer', icon: '⛽' },
  { id: 'queue', label: 'Fila', icon: '🔄' },
  { id: 'shift', label: 'Turno', icon: '🚗' },
];

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('refuel');
  const pending = app.queue.filter((q) => q.status !== 'SYNCED' && q.status !== 'REJECTED').length;

  if (!app.ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ paddingTop: 36, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: colors.surface }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.brand }}>⛽ FleetFuel</Text>
      </View>
      <ConnectionBanner online={app.online} syncing={app.syncing} pending={pending} />
      <View style={{ flex: 1 }}>
        {tab === 'refuel' && <RefuelScreen onSaved={() => setTab('queue')} />}
        {tab === 'queue' && <QueueScreen />}
        {tab === 'shift' && <ShiftScreen />}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, paddingBottom: 18 }}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => {
              haptic.tap();
              setTab(t.id);
            }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10 }}
          >
            <Text style={{ fontSize: 20 }}>{t.icon}</Text>
            <Text style={{ fontSize: 12, fontWeight: tab === t.id ? '700' : '400', color: tab === t.id ? colors.brand : colors.muted }}>
              {t.label}
              {t.id === 'queue' && pending ? ` (${pending})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
