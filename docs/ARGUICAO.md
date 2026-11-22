# Guia de apresentação e arguição técnica — FleetFuel

Este documento é o roteiro para a apresentação e um banco de perguntas que a banca provavelmente vai fazer,
com a resposta e **o arquivo exato** onde mostrar no código.

---

## 1. Roteiro de demonstração (≈ 10 min)

1. **Contexto (30 s)** — Prefeitura com frota; cada veículo tem cota mensal de litros; motoristas abastecem em postos do interior sem sinal; gestão precisa de controle em tempo real e auditoria.
2. **Arquitetura (1 min)** — Diagrama do README. Falar: 3 serviços, banco por serviço, gateway, RabbitMQ, WebSocket.
3. **Subir o ambiente** — `docker compose up --build` (deixe já rodando antes) e `node scripts/seed.mjs`. Abrir o painel em `localhost:8080` (indicador “Tempo real conectado” verde).
4. **Offline-first (3 min)** — no celular: modo avião → registrar 2 abastecimentos com foto → mostrar a aba *Fila* (“Aguardando envio”) e o banner “Sem sinal”. Desligar modo avião → itens viram “Sincronizado” e o painel atualiza **sozinho** (sem F5). Mostrar a foto em *Abastecimentos → Ver*.
5. **Concorrência (2 min)** — `node scripts/concurrency-attack.mjs`: 50 requisições simultâneas numa cota de 100 L → exatamente 20 aceitos, saldo 0. Cenário 2: mesmo `clientId` 10x → 1 débito. Enquanto roda, o painel mostra o feed explodindo em tempo real.
6. **Rejeição em tempo real** — lançar um abastecimento acima do saldo → toast vermelho no painel.
7. **Auditoria (1 min)** — aba *Auditoria* → *Verificar integridade* (✅). Opcional, para impressionar: tentar adulterar no banco:
   ```bash
   docker compose exec postgres-audit psql -U fleetfuel -d audit -c "UPDATE ledger_entries SET payload = '{}' WHERE sequence = 1;"
   # → ERROR: ledger_entries é append-only: UPDATE não permitido
   ```
8. **Clean Architecture (1 min)** — mostrar a árvore `src/core` e rodar `npm run check:core-purity` e `npm test` (51 testes, sem banco).

---

## 2. Perguntas prováveis

### Concorrência (Serviço A)

**“Como você evita que dois abastecimentos simultâneos estourem a cota?”**
Lock pessimista. O caso de uso roda dentro de uma Unit of Work (uma transação). Ele chama `quotas.findForUpdate()`, que executa `SELECT … FROM monthly_quotas … FOR UPDATE`. A segunda transação que pedir a mesma linha **espera** até a primeira dar COMMIT, e aí lê o saldo já atualizado.
→ `services/core-service/src/infra/database/postgres/pg-repositories.ts` (`findForUpdate`) e `src/core/use-cases/register-refuel.ts`.

**“E se você tirar o lock, o que acontece?”**
*Lost update*: as duas leem `used = 0`, as duas aprovam, a segunda gravação sobrescreve a primeira. O teste `concurrency.test.ts` **demonstra** isso: com `serialize: false` aceita os 30 abastecimentos numa cota que só comporta 20.
→ `services/core-service/tests/concurrency.test.ts`.

**“Por que não usou isolamento SERIALIZABLE?”**
Funcionaria, mas é otimista: sob disputa pela mesma linha o Postgres aborta transações com `40001 serialization_failure`, e eu teria que implementar retry. Com `FOR UPDATE` em READ COMMITTED as transações fazem fila e nenhuma é abortada. Também configurei `lock_timeout = 5s` para nenhuma requisição ficar presa para sempre (vira HTTP 503 e o app tenta de novo).

**“Por que não um `UPDATE … SET used = used + x WHERE used + x <= limit`?”**
É uma ótima alternativa atômica (lock implícito numa instrução só). Não usei porque a regra de negócio iria para o SQL — o domínio (`MonthlyQuota.debit`) deixaria de decidir. Com o `FOR UPDATE` a regra fica na entidade, testável sem banco. Como defesa extra, existe `CHECK (used_ml <= limit_ml)` no banco.

**“Pode dar deadlock?”**
Só se duas transações travarem as mesmas linhas em ordem diferente. Todos os casos de uso travam sempre **veículo → cota** (`RegisterRefuel` e `SetMonthlyQuota`). Ordem global fixa elimina o ciclo.

**“Por que travar o veículo também, não só a cota?”**
Porque o hodômetro (`last_odometer_km`) também é estado disputado, e porque a checagem de idempotência por `clientId` precisa acontecer **depois** de um lock: se dois reenvios do mesmo item chegassem juntos, os dois veriam “não existe” e tentariam inserir. Com o lock do veículo, o segundo espera e enxerga o registro do primeiro. (E ainda há `UNIQUE(client_id)` como rede de segurança → HTTP 409.)

**“Por que guarda litros em mililitros?”**
Ponto flutuante: `0.1 + 0.2 = 0.30000000000000004`. Somando centenas de abastecimentos o saldo derivaria. Inteiros em mL (e dinheiro em centavos) são exatos. Teste: `domain.test.ts` → “0.1 + 0.2 = 0.3 exato”.

### Offline-First (App)

**“Como garante que a sincronização é idempotente?”**
O `clientId` (UUID v4 via `expo-crypto`) é gerado **antes** de qualquer envio e gravado no SQLite junto com o abastecimento. Todo reenvio usa o mesmo `clientId` no header `Idempotency-Key`. O servidor, após travar o veículo, procura o `clientId`; se já existe, devolve `200` com o mesmo registro e não debita de novo. Teste: `mobile/tests/sync-engine.test.ts` → “resposta perdida → reenvio … não duplica”.

**“E se a resposta do servidor se perder (sinal caiu depois do envio)?”**
O app não sabe se gravou → trata como erro transitório → tenta de novo com o mesmo `clientId` → servidor responde `200 replay`. Esse é exatamente o caso que a idempotência resolve.

**“O que acontece se o app for fechado no meio do envio?”**
O item fica `SYNCING` no SQLite. Na próxima execução, `resetStuckSyncing()` o devolve para `PENDING`. Como o envio é idempotente, reenviar é seguro.

**“Quando a sincronização dispara?”**
Três gatilhos: (1) `NetInfo` detecta que a conexão voltou; (2) `AppState` volta para primeiro plano; (3) timer de 30 s (respeitando o `nextAttemptAt` de cada item). Execuções concorrentes reaproveitam a mesma promessa, para não enviar o mesmo item duas vezes.
→ `mobile/src/AppContext.tsx` e `mobile/src/sync/sync-engine.ts`.

**“Por que envia em ordem e para no primeiro erro?”**
O hodômetro precisa chegar crescente (o servidor rejeita regressão). Se o item 1 falhar por rede e o item 2 passar, o item 1 seria rejeitado depois. Rejeição **de negócio** (cota estourada) não trava a fila: marca `REJECTED` e segue.

**“O saldo que aparece no app offline é confiável?”**
É uma **estimativa**: último saldo recebido do servidor − litros ainda na fila local. A fonte da verdade é o Serviço A; se o servidor rejeitar, o item volta como `REJECTED` com o motivo. O app avisa (Alert) quando o lançamento parece passar do saldo estimado.

**“Por que a foto é copiada para `documentDirectory`?”**
A câmera grava em cache, e o sistema operacional pode limpar o cache. Um abastecimento offline pode ficar dias na fila; a prova (foto) não pode sumir antes de sincronizar. Também redimensiona para 1024 px / JPEG 60% para caber em redes ruins.

### Mensageria e consistência

**“O que é o Transactional Outbox e por que usou?”**
Problema do *dual write*: gravar no banco e publicar no broker são duas operações; se o serviço cair entre elas, fica inconsistente. Solução: o evento é gravado na tabela `outbox` **na mesma transação** que debita a cota. Um processo (`OutboxRelay`) lê o outbox e publica no RabbitMQ com *publisher confirms*; só marca como publicado depois do ACK do broker.
→ `services/core-service/src/infra/messaging/outbox-relay.ts`.

**“Então a entrega é exatamente uma vez?”**
Não — é **pelo menos uma vez** (*at-least-once*). Se o relay cair entre o publish e o UPDATE, o evento sai de novo. Por isso os consumidores são idempotentes: B usa `SET processed:<eventId> NX` no Redis; C tem `UNIQUE(event_id)` e checa antes de anexar. Resultado prático: *effectively once*.

**“E se um consumidor receber uma mensagem que sempre falha?”**
*Poison message*: depois de N tentativas (3 no B; 5 no C, com backoff exponencial) a mensagem vai para a **Dead Letter Queue** (`live-service.q.dlq`, `audit-service.q.dlq`) em vez de travar a fila. Dá para ver no painel do RabbitMQ.

**“Por que RabbitMQ e não Kafka?”**
O volume (abastecimentos de uma frota municipal) é baixo; preciso de roteamento por tópico (`refuel.*`, `#`), DLQ e ack por mensagem — nativos no RabbitMQ, com operação bem mais simples. Kafka brilharia com retenção longa e replay massivo de eventos; aqui o próprio ledger do Serviço C cumpre o papel de histórico.

**“O Serviço C é mesmo 100% orientado a eventos?”**
Sim. Ele não expõe nenhum endpoint de escrita: o único caso de uso de escrita (`RecordEventUseCase`) é chamado pelo consumidor do RabbitMQ. A API HTTP dele é só leitura (ledger, verificação, relatório).

### Ledger / Auditoria (Serviço C)

**“Como o histórico é imutável?”**
Duas camadas: (1) no banco, trigger que bloqueia `UPDATE`, `DELETE` e `TRUNCATE` em `ledger_entries`; (2) criptográfica, cada registro guarda `hash = SHA-256(hashAnterior | sequência | eventId | tipo | data | payload canônico)`. Se alguém com acesso de superusuário desabilitar o trigger e alterar uma linha, a verificação recalcula os hashes e aponta a sequência adulterada. Teste: `audit.test.ts` → “detecta adulteração”.

**“Dois eventos chegando juntos podem gerar a mesma sequência?”**
Não: o append pega `pg_advisory_xact_lock` antes de ler o último registro, então só um append acontece por vez. Teste com 100 eventos concorrentes gerando 1..100 contínuo.

**“Por que JSON canônico no hash?”**
O `jsonb` do Postgres reordena as chaves. Sem ordenar as chaves antes de calcular o hash, o mesmo conteúdo daria hash diferente na verificação.

### Tempo real (Serviço B)

**“Como o painel atualiza sem polling?”**
WebSocket (`/ws`) no Serviço B. Ao conectar, o painel recebe um **snapshot** completo; depois só **deltas** (`refuel.registered`, `vehicle.position`, `stats.updated`…). Um reducer puro no React aplica cada mensagem ao estado. → `web/src/hooks/useLiveSocket.ts`.

**“E se a conexão cair?”**
Reconexão com backoff exponencial (1 s, 2 s, 4 s… até 15 s), banner de aviso na tela e, ao reconectar, um novo snapshot — então nada que aconteceu durante a queda fica faltando.

**“Por que Redis Pub/Sub no meio?”**
Escalabilidade horizontal: com 3 réplicas do Serviço B, cada painel está conectado a uma só. O caso de uso publica no canal Redis e **todas** as réplicas repassam aos seus sockets.

**“O que é o ‘token efêmero’?”**
O turno do motorista: `POST /sessions` gera 24 bytes aleatórios (hex) e guarda no Redis com TTL de 12 h (`SET … PX`). A telemetria só é aceita com token válido; quando expira, a chave some sozinha — sem job de limpeza. Também há *throttle* de 1 ponto a cada 2 s por sessão.

### Clean Architecture

**“Onde está a regra de negócio?”**
Em `src/core/domain` (entidades e value objects) e `src/core/use-cases`. Ex.: “hodômetro não regride” está em `Vehicle.evaluateRefuel`; “saldo nunca negativo” em `MonthlyQuota.debit`.

**“Como prova que o core não depende de framework?”**
`npm run check:core-purity` varre todos os imports de `src/core` dos 3 serviços e falha se algum não for relativo ao próprio core. Até o hash SHA-256 do ledger entra por uma porta (`Hasher`), para o domínio não importar `node:crypto`.

**“Por que Result em vez de exceção?”**
O erro passa a fazer parte da **assinatura** do método: `debit(): Result<Liters, QuotaExceededError>`. O TypeScript obriga o chamador a tratar o caso de falha, e o `code` literal permite *narrowing*. Exceção fica só para o que é realmente excepcional (banco fora do ar), e aí a Unit of Work faz ROLLBACK.

**“Abastecimento rejeitado também é gravado? Isso não contradiz o Result de falha?”**
É proposital: um abastecimento rejeitado **aconteceu** no mundo real (o combustível pode ter sido colocado) e precisa ficar auditado. O caso de uso devolve `fail(RefuelRejectedError)`, mas a Unit of Work só faz ROLLBACK em exceção — então o registro `REJECTED` e o evento `refuel.rejected` são commitados. Erros de **validação** (sem foto, litros inválidos) não são persistidos.

**“Por que o `Result` está duplicado nos 3 serviços?”**
Para manter os serviços **independentemente implantáveis**. Uma lib compartilhada criaria acoplamento de versão entre eles (um deploy de A forçaria rebuild de B e C). Duplicar 40 linhas estáveis é mais barato.

---

## 3. Números para citar
- 3 microsserviços · 3 bancos isolados (2 Postgres + Redis) · 1 broker · 1 gateway
- **51 testes automatizados** (25 no A, 9 no B, 9 no C, 8 no SyncEngine do app), todos sem infraestrutura
- Teste de concorrência: 30 requisições paralelas numa cota de 20 → exatamente 20 aceitas; sem lock → overselling demonstrado
- Recursos nativos: **câmera** (foto do hodômetro, lanterna), **SQLite**, **geolocalização**, **háptico**, **NetInfo**
