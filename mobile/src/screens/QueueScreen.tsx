import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { Button, Card, colors, s } from '../components/ui';
import type { PendingRefuel } from '../sync/types';

const LABEL: Record<PendingRefuel['status'], { text: string; color: string }> = {
  PENDING: { text: 'Aguardando envio', color: colors.warn },
  SYNCING: { text: 'Enviando…', color: colors.brand },
  ERROR: { text: 'Nova tentativa em breve', color: colors.warn },
  SYNCED: { text: 'Sincronizado', color: colors.ok },
  REJECTED: { text: 'Rejeitado', color: colors.bad },
};

function Item({ item }: { item: PendingRefuel }) {
  const st = item.status === 'SYNCED' && item.serverStatus === 'FLAGGED' ? { text: 'Sincronizado · em revisão', color: colors.warn } : LABEL[item.status];
  return (
    <Card>
      <View style={s.row}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>{item.plate} · {item.liters.toLocaleString('pt-BR')} L</Text>
        <Text style={{ color: st.color, fontWeight: '700' }}>{st.text}</Text>
      </View>
      <Text style={s.muted}>
        {new Date(item.occurredAt).toLocaleString('pt-BR')} · {item.stationName} · {item.odometerKm} km
      </Text>
      {item.status === 'ERROR' && item.lastError ? <Text style={s.muted}>Última falha: {item.lastError} ({item.attempts}x)</Text> : null}
      {item.serverMessage ? <Text style={{ color: item.status === 'REJECTED' ? colors.bad : colors.warn, marginTop: 4 }}>{item.serverMessage}</Text> : null}
      <Text style={[s.muted, { fontSize: 11, marginTop: 4 }]}>ID local: {item.clientId.slice(0, 8)}</Text>
    </Card>
  );
}

export function QueueScreen() {
  const app = useApp();
  const pending = app.queue.filter((q) => q.status === 'PENDING' || q.status === 'ERROR' || q.status === 'SYNCING').length;

  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={app.queue}
      keyExtractor={(i) => i.clientId}
      renderItem={({ item }) => <Item item={item} />}
      refreshControl={<RefreshControl refreshing={app.syncing} onRefresh={app.syncNow} />}
      ListHeaderComponent={
        <Card title="Sincronização">
          <Text style={s.muted}>{pending} pendente(s) · {app.queue.length} no histórico do aparelho</Text>
          {app.lastSync && (
            <Text style={s.muted}>
              Última: {app.lastSync.synced} enviados, {app.lastSync.rejected} rejeitados, {app.lastSync.retrying} para tentar de novo
            </Text>
          )}
          <Button title={app.online ? 'Sincronizar agora' : 'Sem conexão'} onPress={app.syncNow} disabled={!app.online} loading={app.syncing} />
        </Card>
      }
      ListEmptyComponent={<Text style={[s.muted, { textAlign: 'center', marginTop: 20 }]}>Nenhum abastecimento lançado neste aparelho.</Text>}
    />
  );
}
