# 09 — Apache Kafka

> Arquitetura e log · Partições e ordenação · Consumer groups e offsets · Replicação e ISR · Retenção e compaction · Garantias de entrega · Schema Registry · KRaft

---

## 1. Resumo conceitual

### 1.1 O que Kafka é (e o que não é)

Kafka é um **log distribuído, particionado, replicado e append-only**. Essa definição responde a maior parte das perguntas conceituais.

A diferença fundamental para uma fila tradicional (RabbitMQ, SQS): numa fila, a mensagem é **removida** quando consumida. No Kafka, a mensagem **permanece** no log pelo período de retenção, e cada consumidor mantém sua própria posição de leitura (offset). Consequências:

- **Múltiplos consumidores independentes** podem ler os mesmos dados sem interferir uns nos outros. Adicionar um novo consumidor não afeta os existentes e não exige mudar o produtor.
- **Reprocessamento** é possível: basta voltar o offset. Isso é o que viabiliza a arquitetura Kappa e recuperação de bugs em consumidores.
- **Ordenação é preservada** dentro de uma partição, porque o log é sequencial.
- O broker é **burro por design**: ele não rastreia entrega por mensagem, não faz roteamento complexo, não gerencia estado de consumidor. Essa simplicidade é o que permite o throughput altíssimo.

Kafka atinge throughput alto por três mecanismos que vale saber nomear: **escrita sequencial em disco** (muito mais rápida que aleatória, e aproveitando o page cache do SO), **zero-copy** (dados vão do page cache direto para o socket sem passar pelo espaço de usuário) e **batching e compressão** de mensagens tanto no produtor quanto no armazenamento.

### 1.2 Tópicos, partições e ordenação

Um **tópico** é uma categoria lógica de mensagens. Ele é dividido em **partições**, e é a partição que é a unidade real de tudo:

- **Unidade de paralelismo.** Cada partição é consumida por no máximo um consumidor dentro de um consumer group. Portanto **o paralelismo máximo de um consumer group é o número de partições.** Adicionar consumidores além disso deixa os extras ociosos. É uma das perguntas mais frequentes.
- **Unidade de ordenação.** Kafka garante ordem **dentro** de uma partição, nunca entre partições. Se a ordem entre dois eventos importa, eles precisam ir para a mesma partição.
- **Unidade de replicação e de armazenamento.**

**Como a partição é escolhida:** se a mensagem tem **chave**, a partição é `hash(chave) % num_partições` — o que garante que todas as mensagens da mesma chave vão para a mesma partição, e portanto mantêm ordem relativa. Se não tem chave, o produtor distribui (com batching, o comportamento moderno agrupa mensagens sem chave em lotes por partição para eficiência, em vez de round-robin estrito por mensagem).

**A decisão de chave é a decisão de design mais importante ao usar Kafka**, e cai muito:
- Chave = `user_id` garante ordem por usuário. Bom para CDC e para eventos de sessão.
- Chave com distribuição desigual causa **partition skew**: uma partição recebe muito mais tráfego, seu consumidor vira gargalo, e escalar não resolve.
- Sem chave, você ganha distribuição uniforme e perde ordem.

**Aumentar o número de partições quebra a garantia de ordenação por chave**, porque `hash(chave) % N` muda quando N muda: mensagens da mesma chave passam a ir para outra partição, e podem ser consumidas fora de ordem em relação às antigas. E **não é possível reduzir** o número de partições. Por isso o dimensionamento inicial de partições merece cuidado — e a heurística é dimensionar pelo throughput alvo dividido pelo throughput que um consumidor consegue processar, com folga para crescimento.

Partições demais também têm custo: mais file handles e metadados no broker, mais requisições de replicação, maior tempo de recuperação em falha de broker, e mais latência de fim a fim em alguns casos. É um trade-off, não "quanto mais melhor".

### 1.3 Consumer groups, offsets e rebalance

Um **consumer group** é um conjunto de consumidores que dividem o trabalho de ler um tópico. Regras:

- Cada partição é atribuída a **exatamente um** consumidor do grupo.
- Um consumidor pode ler várias partições.
- Grupos diferentes recebem **todas** as mensagens independentemente — é assim que se implementa fan-out.

**Offset** é a posição de leitura. Cada grupo mantém seu próprio offset committado por partição, armazenado num tópico interno do Kafka (`__consumer_offsets`).

**Quando commitar o offset determina a semântica de entrega** — é o ponto mais importante:
- Commitar **antes** de processar → at-most-once (se falhar depois do commit, a mensagem se perde).
- Commitar **depois** de processar → at-least-once (se falhar antes do commit, a mensagem é reprocessada).

**Auto-commit** (`enable.auto.commit=true`) commita periodicamente em background, sem relação com o progresso real do processamento. Isso significa que ele pode commitar mensagens que ainda não foram processadas — produzindo perda — ou reprocessar mensagens já processadas. Para controle real da semântica, desligue o auto-commit e commite manualmente após o processamento. Saber disso é um marcador de experiência prática.

**Rebalance** é a redistribuição de partições entre consumidores do grupo, disparada quando: um consumidor entra, sai, morre, ou não envia heartbeat a tempo; ou quando o número de partições muda.

O rebalance clássico (eager) **para o grupo inteiro**: todos param, devolvem suas partições, e recebem uma nova atribuição — o famoso "stop-the-world". Em grupos grandes, isso causa pausas perceptíveis. Estratégias **cooperativas** (incremental cooperative rebalancing) redistribuem apenas as partições que precisam mudar, sem parar todo mundo, e são a recomendação moderna. **Static membership** permite que um consumidor que reinicia rapidamente reassuma suas partições sem disparar rebalance, o que é valioso em ambientes com deploy frequente ou Kubernetes.

**Causa comum de rebalance indesejado, e ótima resposta de troubleshooting:** processamento lento. Se o consumidor demora mais que `max.poll.interval.ms` entre chamadas de poll, o coordenador o considera morto e dispara rebalance — e aí a mensagem é reprocessada por outro consumidor, que também demora, e o grupo entra num ciclo de rebalances sem progredir. A correção é reduzir `max.poll.records`, aumentar o intervalo permitido, ou mover o processamento pesado para fora do loop de poll.

### 1.4 Replicação, ISR e durabilidade

Cada partição tem um **líder** e N-1 **followers** (o fator de replicação). Todas as leituras e escritas vão para o líder; os followers replicam.

**ISR (In-Sync Replicas)** é o conjunto de réplicas que estão suficientemente atualizadas em relação ao líder. Uma réplica que fica para trás além de um limite é removida do ISR e não é elegível para virar líder (em configuração segura).

**As três configurações que determinam durabilidade** — e a pergunta "como você garante que não perde mensagem?" espera exatamente essas três:

**`acks` no produtor:**
- `acks=0`: não espera confirmação. Máximo throughput, pode perder tudo.
- `acks=1`: espera só o líder. Se o líder morrer antes de replicar, perde.
- `acks=all` (ou `-1`): espera todas as réplicas do ISR confirmarem. É o necessário para durabilidade.

**`min.insync.replicas` no tópico/broker:** o número mínimo de réplicas que precisam estar no ISR para que uma escrita com `acks=all` seja aceita. Se cair abaixo, o produtor recebe erro em vez de escrever com durabilidade insuficiente.

**A combinação correta:** `replication.factor=3` + `min.insync.replicas=2` + `acks=all`. Isso significa: pelo menos duas cópias antes de confirmar, e você tolera a perda de um broker continuando a aceitar escritas. Se usar `min.insync.replicas=3` com fator 3, a perda de qualquer broker **para as escritas** — o que troca disponibilidade por durabilidade e raramente é o desejado.

**`unclean.leader.election.enable`**: se `true`, permite que uma réplica fora do ISR vire líder quando não há nenhuma no ISR. Isso mantém a disponibilidade ao custo de **perder mensagens** que existiam apenas nas réplicas mais atualizadas. É a escolha CAP explícita do Kafka: `false` (padrão moderno) é CP, `true` é AP. Excelente resposta para conectar Kafka ao teorema CAP.

### 1.5 Retenção e log compaction

**Retenção por tempo ou tamanho:** mensagens são apagadas após N dias ou quando a partição excede um tamanho. É o modo padrão (`cleanup.policy=delete`).

**Log compaction** (`cleanup.policy=compact`): em vez de apagar por idade, o Kafka mantém **pelo menos o último valor de cada chave**, para sempre. Mensagens antigas com a mesma chave são removidas na compactação.

Compaction transforma o tópico numa **tabela de estado atual**: relendo-o do início, você reconstrói o estado corrente de todas as chaves. É o mecanismo por trás de KTables no Kafka Streams, de tópicos de configuração, e do padrão de "changelog" de CDC.

Detalhes que caem:
- Uma mensagem com valor `null` para uma chave é um **tombstone**: sinaliza deleção, e é mantida por um período configurável antes de ser removida, para que consumidores lentos consigam vê-la.
- Compaction não garante remoção **imediata** de duplicatas — ela roda em background e o head do log (a parte mais recente) pode ter várias versões da mesma chave.
- É possível combinar `delete` e `compact`.
- Para **LGPD/GDPR**, compaction com tombstone é o mecanismo padrão de "direito ao esquecimento" em Kafka, já que o log é imutável e você não pode apagar uma mensagem no meio dele.

### 1.6 Garantias de entrega e transações

**Produtor idempotente** (`enable.idempotence=true`, padrão nas versões modernas): o produtor recebe um Producer ID e mantém um número de sequência por partição. O broker rastreia o maior número de sequência gravado por PID e partição, e descarta duplicatas de retry, ainda respondendo com ack. Isso elimina duplicação causada por reenvio — que é a fonte mais comum de duplicata.

Limite importante: idempotência do produtor cobre **uma sessão do produtor e uma partição por vez**. Não cobre reinício do produtor nem escrita atômica em múltiplas partições.

**Transações** resolvem isso: permitem que um conjunto de escritas em múltiplas partições e tópicos, mais o commit dos offsets consumidos, sejam atômicos. É o padrão **read-process-write**: consumir de um tópico, processar, produzir em outro, e commitar o offset — tudo ou nada. Consumidores configurados com `isolation.level=read_committed` só enxergam mensagens de transações commitadas.

**Exactly-once semantics (EOS)** no Kafka é essa combinação. Mas o escopo importa e é onde candidatos erram: EOS é de ponta a ponta quando a origem **e** o destino são Kafka. Se o destino é um sistema externo que não participa da transação, a garantia termina na fronteira — e você precisa de idempotência no destino para obter o efeito equivalente.

Custos de EOS: transações adicionam coordenação (um coordenador de transação, marcadores no log) e latência; consumidores em `read_committed` só leem até o ponto onde não há transação aberta pendente, o que pode adicionar atraso; e uma transação travada bloqueia o avanço dos leitores até expirar.

### 1.7 Schema Registry e evolução

Kafka transporta bytes; ele não sabe nem se importa com o formato. Isso é ótimo para desempenho e péssimo para governança — nada impede um produtor de mudar o formato e quebrar todos os consumidores silenciosamente.

**Schema Registry** resolve: schemas (tipicamente Avro, Protobuf ou JSON Schema) são registrados e versionados; o produtor grava um identificador de schema no início da mensagem; o consumidor busca o schema pelo ID para desserializar. E o registry **valida compatibilidade** antes de aceitar uma nova versão.

Modos de compatibilidade:
- **Backward**: consumidores com o schema novo leem dados escritos com o antigo. Permite adicionar campo opcional com default e remover campos. É o modo mais usado, porque permite atualizar consumidores primeiro.
- **Forward**: consumidores com o schema antigo leem dados escritos com o novo. Permite atualizar produtores primeiro.
- **Full**: ambos.
- **None**: sem validação — evite.

A ordem de deploy depende do modo, e essa é uma pergunta prática boa: com backward compatibility, atualize os **consumidores** primeiro; com forward, os **produtores** primeiro.

Isso é a implementação técnica de um **contrato de dados** (ver arquivo 11) na camada de mensageria.

### 1.8 Kafka Connect, Streams e o ecossistema

**Kafka Connect**: framework para integração sem escrever código — source connectors trazem dados de sistemas externos para o Kafka, sink connectors levam do Kafka para fora. Roda distribuído, com gestão de offsets e retries. É onde o Debezium (CDC) vive.

**Kafka Streams**: biblioteca (não cluster separado) para processamento de streams em Java, com estado local respaldado por tópicos de changelog. Conceitos: **KStream** (fluxo de eventos) e **KTable** (estado atual por chave, respaldado por tópico compactado). A dualidade stream-table é a ideia central: um stream de mudanças pode ser materializado como tabela, e uma tabela pode ser lida como stream de mudanças.

**ksqlDB**: SQL sobre streams, construído sobre Kafka Streams.

**KRaft**: o modo de consenso interno do Kafka baseado em Raft, que substituiu o ZooKeeper para gerenciamento de metadados. É o padrão e o recomendado a partir do Kafka 4.0, onde o ZooKeeper foi removido. Vantagens: menos um sistema para operar, failover de controlador mais rápido, e melhor escalabilidade em número de partições. Saber que ZooKeeper saiu de cena é um marcador simples de estar atualizado.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. O que é Kafka e como difere de uma fila tradicional?**

*Resposta modelo:* É um log distribuído, particionado, replicado e append-only. A diferença central para uma fila é que a mensagem não é removida quando consumida: ela permanece pelo período de retenção, e cada consumidor mantém sua própria posição de leitura.

Isso permite múltiplos consumidores independentes lendo os mesmos dados sem interferência, e permite reprocessar simplesmente voltando o offset. O broker é deliberadamente simples — não rastreia entrega por mensagem — e é essa simplicidade que sustenta o throughput alto.

---

**🟢 P2. O que é uma partição e por que ela existe?**

*Resposta modelo:* É a subdivisão de um tópico, e é a unidade de tudo que importa: de paralelismo, porque cada partição é consumida por no máximo um consumidor dentro de um grupo; de ordenação, porque Kafka garante ordem dentro da partição e nunca entre partições; e de replicação e armazenamento.

A consequência prática mais citada é que o paralelismo máximo de um consumer group é o número de partições — adicionar consumidores além disso deixa os extras ociosos.

---

**🟢 P3. O que é um consumer group?**

*Resposta modelo:* É um conjunto de consumidores que dividem o trabalho de ler um tópico. Cada partição é atribuída a exatamente um consumidor do grupo, e um consumidor pode ler várias partições. Grupos diferentes recebem todas as mensagens de forma independente — é assim que se faz fan-out para vários sistemas consumindo o mesmo tópico.

Cada grupo mantém seu próprio offset committado por partição, armazenado num tópico interno do Kafka.

---

**🟢 P4. O que é offset?**

*Resposta modelo:* É a posição sequencial de uma mensagem dentro de uma partição, e também o marcador de até onde um consumer group já leu. O consumidor commita o offset para registrar progresso, e ao reiniciar retoma dali.

O momento do commit determina a semântica de entrega: commitar antes de processar dá at-most-once; depois, at-least-once.

---

### 🟡 Intermediário

**🟡 P5. Como o Kafka garante ordenação? Quais os limites?**

*Resposta modelo:* Ele garante ordem **dentro de uma partição**, porque o log é sequencial e append-only. Não há garantia de ordem entre partições.

Então, se a ordem entre dois eventos importa, eles precisam ir para a mesma partição — o que se consegue usando a mesma **chave**, já que a partição é escolhida por hash da chave. Para CDC de um banco, por exemplo, usar a chave primária como chave da mensagem garante que todas as mudanças de uma linha sejam ordenadas entre si.

Duas limitações importantes. Primeira: se você **aumentar o número de partições**, o hash passa a mapear a mesma chave para outra partição, e a garantia de ordem se quebra na transição. Segunda: dentro do consumidor, se você processar as mensagens em paralelo por thread, perde a ordem que o Kafka entregou — a garantia é da entrega, não do seu processamento.

---

**🟡 P6. Como você garante que uma mensagem não se perca?**

*Resposta modelo:* Combinando três configurações. `acks=all` no produtor, para que ele espere a confirmação de todas as réplicas em sincronia, não só do líder. `replication.factor=3` no tópico. E `min.insync.replicas=2`, que exige pelo menos duas réplicas em sincronia para aceitar a escrita — assim você tolera a perda de um broker sem parar de escrever e sem escrever com durabilidade insuficiente.

Além disso, `unclean.leader.election.enable=false`, para não permitir que uma réplica desatualizada vire líder, o que descartaria mensagens confirmadas.

Do lado do consumidor, desligar o auto-commit e commitar após processar com sucesso, senão você pode confirmar leitura de algo que não foi processado.

E do lado do produtor, garantir que o retry esteja habilitado com produtor idempotente, para que o retry não gere duplicata.

*Follow-up esperado:* "Por que não `min.insync.replicas=3` com fator 3?" → Porque aí a perda de qualquer broker interrompe as escritas. Você trocaria disponibilidade por uma durabilidade marginalmente maior, o que raramente é o compromisso desejado.

---

**🟡 P7. O que é rebalance e por que pode ser um problema?**

*Resposta modelo:* É a redistribuição de partições entre os consumidores do grupo, disparada quando um consumidor entra, sai, morre ou perde o heartbeat, ou quando o número de partições muda.

O problema é que o rebalance clássico para o grupo inteiro: todos devolvem suas partições e recebem novas atribuições, o que causa uma pausa no consumo. Em grupos grandes isso é perceptível.

A causa mais comum de rebalance indesejado é **processamento lento**: se o consumidor demora mais que o intervalo máximo permitido entre polls, o coordenador o considera morto e dispara rebalance. Aí a mensagem é reprocessada por outro consumidor, que também demora, e o grupo entra num ciclo de rebalances sem progredir. Corrijo reduzindo o número de registros por poll, aumentando o intervalo permitido, ou tirando o processamento pesado do loop de poll.

Estruturalmente, uso rebalance cooperativo, que redistribui só as partições necessárias sem parar o grupo, e static membership, que permite a um consumidor que reinicia rapidamente reassumir suas partições sem disparar rebalance — muito útil com deploys frequentes.

---

**🟡 P8. O que é log compaction e quando usar?**

*Resposta modelo:* Em vez de apagar mensagens por idade, o Kafka mantém pelo menos o último valor de cada chave, para sempre. Isso transforma o tópico numa tabela de estado atual: relendo do início, você reconstrói o estado corrente de todas as chaves.

Uso para tópicos que representam **estado**, não eventos: configuração, cadastro, changelog de CDC, e os stores respaldados do Kafka Streams. Para eventos — cliques, transações, logs — retenção por tempo é o correto, porque cada evento é significativo por si.

Detalhes: uma mensagem com valor nulo é um tombstone, que sinaliza deleção e é mantida por um período antes de ser removida, para que consumidores lentos a vejam. E a compactação roda em background, então a parte mais recente do log pode ter várias versões da mesma chave — compaction não garante unicidade instantânea.

É também o mecanismo padrão para atender direito ao esquecimento sob LGPD/GDPR em Kafka, já que o log é imutável e não se apaga uma mensagem no meio dele.

---

**🟡 P9. Como você dimensiona o número de partições?**

*Resposta modelo:* Pelo throughput alvo dividido pelo throughput que um único consumidor consegue processar, com folga para crescimento — porque aumentar depois é problemático e diminuir é impossível.

O limite superior é o paralelismo desejado: com N partições, no máximo N consumidores trabalham simultaneamente naquele grupo.

Mas mais não é sempre melhor. Partições demais custam file handles e metadados no broker, mais requisições de replicação, tempo de recuperação maior quando um broker cai, e podem aumentar a latência fim a fim.

E lembraria que aumentar partições depois quebra a garantia de ordenação por chave, porque o mapeamento de hash muda. Então, se ordenação por chave for requisito, o dimensionamento inicial precisa ter folga real — ou você precisa de um plano de migração de tópico.

---

### 🔴 Avançado

**🔴 P10. Explique exactly-once no Kafka e seus limites.**

*Resposta modelo:* São dois mecanismos que se somam.

**Produtor idempotente:** o produtor recebe um Producer ID e mantém número de sequência por partição; o broker rastreia o maior número gravado por PID e partição e descarta duplicatas de retry, ainda respondendo com ack. Isso elimina a fonte mais comum de duplicata, que é o reenvio. O limite é que cobre uma sessão do produtor e uma partição por vez — não cobre reinício nem escrita atômica em múltiplas partições.

**Transações:** permitem que escritas em múltiplas partições e tópicos, mais o commit dos offsets consumidos, sejam atômicas. É o padrão read-process-write: consumir, processar, produzir e commitar offset como unidade. Consumidores em `read_committed` só enxergam transações commitadas.

Os limites, que são o ponto da pergunta: isso é exactly-once de ponta a ponta **quando origem e destino são Kafka**. Se o destino é um banco ou uma API externa que não participa da transação, a garantia termina na fronteira, e você precisa de idempotência no destino para obter o efeito equivalente.

E há custo: transações adicionam coordenação e latência; consumidores em `read_committed` só leem até onde não há transação aberta pendente, o que atrasa; e uma transação travada bloqueia o avanço dos leitores até expirar. Na maioria dos sistemas eu preferiria at-least-once com escrita idempotente no destino, que dá o mesmo resultado observável com menos complexidade e melhor throughput.

---

**🔴 P11. Um consumer group está com lag crescente. Como investiga?**

*Resposta modelo:* Primeiro, verifico se o lag é **uniforme entre partições ou concentrado**. Essa única observação separa dois problemas completamente diferentes.

**Concentrado em poucas partições:** ou há partition skew — a chave escolhida concentra tráfego numa partição — ou o consumidor daquelas partições está travado ou morto. Escalar não resolve skew; a correção é rever a chave ou redistribuir.

**Uniforme:** é capacidade ou gargalo compartilhado. Aí verifico, nesta ordem:

O **sink** — na maioria dos casos que já vi, o consumidor não está lento, está esperando um destino lento ou degradado. Escalar o consumidor nesse caso piora, porque aumenta a pressão sobre o gargalo.

**Rebalances frequentes** — se o grupo está em ciclo de rebalance por processamento lento entre polls, ele não progride. Isso aparece nos logs e é uma causa que passa despercebida com frequência.

**Número de consumidores versus partições** — se já tenho consumidores igual ao número de partições, adicionar mais não faz nada. Nesse caso a saída é aumentar partições (com o cuidado da ordenação) ou paralelizar o processamento dentro do consumidor, aceitando perder ordem.

**Pico legítimo de volume**, GC, ou recursos insuficientes.

Para recuperar, uma decisão precisa ser explícita: **recuperar tudo ou pular para o presente?** Se o consumo alimenta um alerta operacional, dado de horas atrás não tem valor e pode ser melhor avançar o offset e reprocessar o buraco em batch. Se alimenta uma tabela transacional, tem que recuperar tudo, em ordem.

Para prevenir: alerta sobre lag **em tempo**, não em número de mensagens — "10 mil mensagens" significa coisas diferentes conforme a taxa; monitoramento separado da latência do sink; e teste de carga com volume de pico.

---

**🔴 P12. Você precisa reprocessar 30 dias de um tópico com uma lógica corrigida. Como faz sem afetar os consumidores atuais?**

*Resposta modelo:* Uso um **consumer group novo**. Como o offset é por grupo, um grupo novo lê o tópico independentemente, sem tocar no progresso do grupo em produção. Configuro para começar do início ou de um timestamp específico — Kafka permite buscar offset por timestamp, o que é a forma correta de dizer "comece em 30 dias atrás".

Antes de começar, três verificações:

**A retenção cobre 30 dias?** Se a retenção é de 7, os dados não existem mais e o plano inteiro muda: preciso da fonte original ou de uma camada bruta já persistida.

**O destino tolera reescrita?** Prefiro escrever numa tabela sombra e trocar atomicamente no fim, para que os consumidores nunca vejam estado parcial. Se escrever direto, a escrita precisa ser idempotente por chave para não duplicar.

**Qual o impacto no cluster?** Reprocessar 30 dias em velocidade máxima gera carga de leitura muito acima do normal e pode competir com os consumidores de produção pelo I/O dos brokers. Limito a taxa e, se possível, rodo em janela de menor uso.

Durante a execução, valido incrementalmente comparando com o resultado antigo em métricas-chave, em vez de descobrir no fim que algo estava errado desde o começo.

Se a lógica nova for para valer daí em diante, o corte precisa ser planejado: normalmente, deixo o novo consumidor alcançar o presente e então faço o switch, evitando janela de dupla escrita ou de buraco.

---

**🔴 P13. Como você lidaria com uma mensagem que sempre falha no processamento (poison pill)?**

*Resposta modelo:* O risco é bloquear a partição inteira: se o consumidor tenta, falha, e reprocessa a mesma mensagem indefinidamente, nenhuma mensagem posterior daquela partição avança. É um modo de falha silencioso e grave, porque o consumidor parece vivo.

A solução padrão é **dead letter queue**: após N tentativas, a mensagem é publicada num tópico de DLQ com metadados de contexto — erro, stack trace, offset, timestamp, número de tentativas — e o offset original é commitado para o consumo prosseguir.

Alguns cuidados que separam uma resposta completa:

**A DLQ precisa ser monitorada e ter dono.** DLQ que ninguém olha é o mesmo que descartar, mas com a ilusão de que foi tratado.

**Distinguir erro transitório de permanente.** Timeout de rede merece retry; erro de desserialização não vai melhorar com repetição. Retentar indefinidamente um erro permanente desperdiça recursos e mascara o problema.

**Ordenação.** Se a ordem importa para aquela chave, mandar uma mensagem para a DLQ e seguir adiante significa que as mensagens seguintes daquela chave serão processadas sem a anterior — o que pode ser semanticamente inaceitável. Nesses casos, a alternativa é parar aquela chave especificamente, ou aceitar parar a partição e alertar.

**Erro de desserialização** é caso especial e comum: se o produtor mudou o formato, todas as mensagens novas falham. É exatamente o problema que Schema Registry com validação de compatibilidade previne — e a solução estrutural é essa, não a DLQ.

**Reprocessamento da DLQ** deve ser um processo explícito, com correção do código ou do dado antes de reinjetar.

---

**🔴 P14. Como você desenharia um pipeline CDC de um Postgres para um data lake usando Kafka?**

*Resposta modelo:* Estruturaria em quatro camadas.

**Captura.** Debezium via Kafka Connect, lendo o WAL do Postgres com um slot de replicação. Uso a chave primária da tabela como chave da mensagem, para que todas as mudanças de uma linha caiam na mesma partição e mantenham ordem — isso é requisito, não otimização, porque aplicar um update antes do insert corrompe o resultado. Um tópico por tabela.

O ponto operacional crítico: **monitorar o slot de replicação**. Se o conector parar e o slot permanecer, o Postgres retém WAL indefinidamente e pode encher o disco da produção. Isso derruba o banco, não o pipeline — é o risco mais sério dessa arquitetura e precisa de alerta dedicado.

**Snapshot inicial.** O Debezium faz um snapshot consistente e depois continua do ponto correspondente do log. É a parte mais delicada, e em tabelas grandes vale usar snapshot incremental para não bloquear nem gerar um pico enorme.

**Transporte.** Retenção do tópico dimensionada para cobrir a janela de reprocessamento que eu quero suportar. Schema Registry com Avro e compatibilidade backward, para que uma mudança de DDL na origem não quebre os consumidores silenciosamente.

**Ingestão no lake.** Um sink escrevendo em formato de tabela transacional. E aqui uma decisão explícita: escrevo o **histórico de mudanças** append-only, com o tipo de operação e o timestamp, como camada bruta; e derivo dele o **estado atual** via MERGE por chave primária, numa camada seguinte. Manter os dois é o que permite tanto reconstruir o presente quanto atender auditoria e construir SCD Tipo 2 depois.

**Cuidados adicionais:** deletes precisam ser propagados explicitamente, senão o espelho fica com registros fantasma; a ordenação por chave precisa ser preservada também na escrita, não só no transporte; e mudanças de DDL na origem devem gerar alerta, porque nem toda evolução é graciosa.

Se o requisito de latência for de minutos e não segundos, eu ainda consideraria se o Kafka é necessário — um Connect escrevendo direto no lake, ou uma ferramenta gerenciada de CDC, pode ser suficiente e bem mais simples de operar. Kafka se justifica quando há múltiplos consumidores do mesmo fluxo, ou quando a capacidade de reprocessar do log tem valor.

---

**🔴 P15. O que mudou com o KRaft e por que isso importa?**

*Resposta modelo:* O KRaft substituiu o ZooKeeper como sistema de gerenciamento de metadados do Kafka, usando um protocolo de consenso baseado em Raft implementado dentro do próprio Kafka. É o padrão e o modo recomendado, e o ZooKeeper foi removido a partir do Kafka 4.0.

Por que importa, na prática: elimina um sistema distribuído inteiro da operação — um cluster a menos para dimensionar, monitorar, atualizar e recuperar, com seu próprio modelo de falha. O failover de controlador é mais rápido, porque o estado de metadados já está replicado como um log em vez de precisar ser recarregado. E escala melhor em número de partições, porque a propagação de metadados deixa de depender de watches do ZooKeeper.

Conceitualmente, é um bom exemplo de um princípio geral de sistemas distribuídos: usar consenso apenas para metadados e coordenação, mantendo o caminho de dados fora dele. O Kafka faz consenso via KRaft para "quem é o líder de cada partição, qual a configuração", e replica os dados por um protocolo mais leve baseado em ISR. Misturar as duas coisas custaria muito throughput.

Para uma migração real, o que eu observaria é a versão mínima suportada e o caminho de migração, já que clusters em ZooKeeper precisam de um procedimento específico e há uma janela de convivência.

---

## 3. Armadilhas comuns

**Achar que adicionar consumidores sempre aumenta o throughput.** O teto é o número de partições. Consumidores extras no mesmo grupo ficam ociosos.

**Dizer que Kafka garante ordenação global.** Garante apenas dentro da partição. E mesmo isso se perde se o consumidor processar em paralelo internamente.

**Esquecer que aumentar partições quebra a ordenação por chave.** O hash muda, a chave passa a mapear para outra partição.

**Deixar auto-commit ligado achando que tem at-least-once.** Auto-commit commita por tempo, sem relação com o progresso do processamento — pode confirmar mensagens não processadas, gerando perda.

**Configurar `acks=all` sem `min.insync.replicas`.** Se o ISR encolher para uma réplica, `acks=all` significa "espere essa única réplica", e a durabilidade prometida não existe.

**Usar `min.insync.replicas` igual ao fator de replicação.** A perda de qualquer broker para as escritas.

**Tratar Kafka como banco de dados.** Ele é um log; consulta por chave arbitrária, query analítica e atualização pontual não são o modelo. Materialize num banco ou numa tabela para isso.

**Ignorar o risco do slot de replicação em CDC.** Slot abandonado retém WAL e pode encher o disco do banco de produção. É um incidente de produção, não do pipeline.

**Não ter DLQ, ou ter uma que ninguém monitora.** Sem DLQ, uma mensagem venenosa bloqueia a partição. Com DLQ sem dono, o dado é descartado com aparência de tratado.

**Alertar sobre lag em número de mensagens.** Dez mil mensagens pode ser um segundo ou um dia, dependendo da taxa. Alerte em tempo.

**Escalar consumidores quando o gargalo é o sink.** Piora, porque aumenta a pressão sobre o recurso já saturado.

**Prometer exactly-once sem verificar o destino.** A garantia termina onde a transação do Kafka termina. Se o sink é externo e não idempotente, não existe exactly-once.

**Mencionar ZooKeeper como componente atual.** Foi removido a partir do Kafka 4.0, substituído pelo KRaft. É um marcador simples e visível de estar desatualizado.
