import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useApp } from '../AppContext';
import { enqueueRefuel, pendingLitersFor } from '../db/database';
import { currentPosition, haptic, persistOdometerPhoto } from '../services/device';
import { Button, Card, colors, Field, s } from '../components/ui';
import { CameraScreen } from './CameraScreen';

const num = (v: string) => Number(v.replace(',', '.'));

export function RefuelScreen({ onSaved }: { onSaved: () => void }) {
  const app = useApp();
  const vehicle = app.vehicles.find((v) => v.id === app.vehicleId) ?? null;
  const [form, setForm] = useState({ liters: '', odometer: '', price: '', station: '' });
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingLiters, setPendingLiters] = useState(0);

  useEffect(() => {
    if (vehicle) pendingLitersFor(vehicle.id).then(setPendingLiters);
  }, [vehicle, app.queue]);

  // Saldo estimado OFFLINE = último saldo conhecido do servidor − litros ainda na fila local.
  const estimated = vehicle?.remainingLiters !== null && vehicle?.remainingLiters !== undefined ? vehicle.remainingLiters - pendingLiters : null;

  if (!vehicle || !app.driverName) {
    return (
      <View style={{ padding: 16 }}>
        <Card title="Configure o turno">
          <Text style={s.muted}>Vá na aba "Turno", informe seu nome e escolha o veículo antes de lançar abastecimentos.</Text>
        </Card>
      </View>
    );
  }

  const validate = () => {
    const e: Record<string, string> = {};
    const liters = num(form.liters);
    const odo = Number(form.odometer);
    if (!(liters > 0 && liters <= 1000)) e.liters = 'Informe os litros (até 1000)';
    if (!Number.isInteger(odo) || odo < 0) e.odometer = 'Hodômetro deve ser um número inteiro';
    else if (vehicle.lastOdometerKm !== null && odo < vehicle.lastOdometerKm) e.odometer = `Menor que o último registrado (${vehicle.lastOdometerKm} km)`;
    if (!(num(form.price) > 0)) e.price = 'Informe o preço por litro';
    if (!form.station.trim()) e.station = 'Informe o posto';
    if (!photoUri) e.photo = 'A foto do hodômetro é obrigatória';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) {
      haptic.error();
      return;
    }
    const liters = num(form.liters);
    if (estimated !== null && liters > estimated) {
      const go = await new Promise<boolean>((resolve) =>
        Alert.alert('Cota possivelmente insuficiente', `Saldo estimado: ${estimated.toFixed(1)} L. O servidor pode rejeitar. Registrar mesmo assim?`, [
          { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Registrar', onPress: () => resolve(true) },
        ]),
      );
      if (!go) return;
    }

    setSaving(true);
    try {
      // 1) A chave de idempotência nasce AQUI, antes de qualquer tentativa de envio.
      const clientId = Crypto.randomUUID();
      const [storedPhoto, position] = await Promise.all([persistOdometerPhoto(photoUri!, clientId), currentPosition()]);
      // 2) Grava no SQLite. A partir daqui o abastecimento está seguro, com ou sem sinal.
      await enqueueRefuel({
        clientId,
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        driverName: app.driverName,
        stationName: form.station.trim(),
        liters,
        odometerKm: Number(form.odometer),
        pricePerLiterCents: Math.round(num(form.price) * 100),
        occurredAt: new Date().toISOString(),
        photoUri: storedPhoto,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
      });
      haptic.success();
      setForm({ liters: '', odometer: '', price: form.price, station: form.station });
      setPhotoUri(null);
      await app.reloadQueue();
      // 3) Tenta enviar já (se estiver online); senão fica na fila.
      void app.syncNow();
      Alert.alert(app.online ? 'Abastecimento registrado' : 'Salvo no aparelho', app.online ? 'Enviando para o servidor…' : 'Será enviado automaticamente quando houver sinal.');
      onSaved();
    } catch (err) {
      haptic.error();
      Alert.alert('Erro ao salvar', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={s.row}>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{vehicle.plate}</Text>
            <Text style={s.muted}>{vehicle.model} · {vehicle.department}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.muted}>Saldo estimado</Text>
            <Text style={{ fontSize: 20, fontWeight: '700', color: estimated !== null && estimated < 20 ? colors.bad : colors.ok }}>
              {estimated === null ? '—' : `${estimated.toFixed(1)} L`}
            </Text>
          </View>
        </View>
        {pendingLiters > 0 && <Text style={[s.muted, { marginTop: 6 }]}>Inclui {pendingLiters.toFixed(1)} L ainda não sincronizados</Text>}
      </Card>

      <Card title="Novo abastecimento">
        <Field label="Litros" keyboardType="decimal-pad" value={form.liters} onChangeText={set('liters')} placeholder="40,5" error={errors.liters} />
        <Field
          label={`Hodômetro (km)${vehicle.lastOdometerKm !== null ? ` · último: ${vehicle.lastOdometerKm}` : ''}`}
          keyboardType="number-pad"
          value={form.odometer}
          onChangeText={set('odometer')}
          error={errors.odometer}
        />
        <Field label="Preço por litro (R$)" keyboardType="decimal-pad" value={form.price} onChangeText={set('price')} placeholder="6,29" error={errors.price} />
        <Field label="Posto" value={form.station} onChangeText={set('station')} placeholder="Posto Central" error={errors.station} />

        <Text style={s.label}>Foto do hodômetro</Text>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={{ width: '100%', height: 180, borderRadius: 8, marginBottom: 6 }} resizeMode="cover" />
        ) : null}
        <Button title={photoUri ? '📷 Tirar outra foto' : '📷 Fotografar hodômetro'} variant="ghost" onPress={() => setCamera(true)} />
        {errors.photo ? <Text style={s.error}>{errors.photo}</Text> : null}

        <View style={{ height: 10 }} />
        <Button title={app.online ? 'Registrar abastecimento' : 'Salvar offline'} onPress={save} loading={saving} />
      </Card>

      <CameraScreen
        visible={camera}
        onClose={() => setCamera(false)}
        onCaptured={(uri) => {
          setPhotoUri(uri);
          setCamera(false);
        }}
      />
    </ScrollView>
  );
}
