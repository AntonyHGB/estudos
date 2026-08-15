# 05 — Sistemas Distribuídos Aplicados a Dados

> Particionamento e sharding · Shuffle · Data skew · Teorema CAP e PACELC · Consistência · Replicação · Consenso · Tolerância a falhas

Este tópico é onde as perguntas 🔴 se concentram. Não é preciso ser especialista em teoria distribuída, mas você precisa saber explicar *por que* um job fica lento e *por que* um sistema distribuído não pode ter tudo ao mesmo tempo.

---

## 1. Resumo conceitual

### 1.1 A premissa: por que distribuir

Distribuir dados existe por três razões, e distingui-las importa porque cada uma tem soluções diferentes:

- **Volume**: o dado não cabe numa máquina.
- **Throughput**: uma máquina não dá conta da carga de leitura ou escrita.
- **Disponibilidade**: uma máquina falha, e você precisa continuar operando.

E distribuir cria três problemas novos que não existiam:

- **Coordenação**: para fazer algo consistente, as máquinas precisam concordar, e concordar custa tempo.
- **Falha parcial**: numa máquina, ou funciona ou não funciona. Em N máquinas, uma pode falhar enquanto as outras continuam — e você pode não saber se ela falhou ou se só está lenta. Essa impossibilidade de distinguir "morto" de "lento" é a raiz de quase toda a dificuldade de sistemas distribuídos.
- **Movimentação de dados pela rede**: rede é ordens de grandeza mais lenta que memória. Todo o trabalho de otimização em engines distribuídas se resume a **evitar mover dados**.

Guarde esta frase, ela responde metade das perguntas deste arquivo: **em processamento distribuído, o custo dominante é mover dados, não computá-los.**

### 1.2 Particionamento e sharding

**Partição** é uma fatia horizontal de um dataset. **Sharding** é o mesmo conceito aplicado a bancos de dados, onde cada shard normalmente vive num servidor diferente. Os termos se sobrepõem; em contexto analítico fala-se em partição, em contexto OLTP fala-se em shard.

Vale distinguir dois eixos:
- **Particionamento horizontal**: dividir linhas entre nós (o caso comum).
- **Particionamento vertical**: dividir colunas entre nós ou tabelas (menos comum, mas é o que armazenamento colunar faz internamente).

**Estratégias de particionamento:**

**Por intervalo (range)**: cada partição cobre uma faixa de valores (janeiro, fevereiro...). Vantagem: consultas por intervalo leem poucas partições, e é natural para dados temporais. Desvantagem: **hotspot** — se todo mundo escreve "hoje", a partição de hoje recebe toda a carga de escrita, e as antigas ficam ociosas. É o caso clássico de partição por data em sistemas de escrita intensa.

**Por hash**: aplica uma função hash na chave e usa o resto da divisão pelo número de partições. Vantagem: distribuição uniforme, sem hotspot. Desvantagem: perde a localidade — uma consulta por intervalo precisa varrer todas as partições, porque valores adjacentes caem em partições diferentes.

**Híbrido (composite)**: hash dentro de um range. Particionar por mês e, dentro do mês, por hash da chave. Combina pruning temporal com distribuição uniforme. É o padrão mais usado na prática em sistemas grandes.

**Por lista**: partições explícitas por valor (por país, por região). Simples e legível; ruim quando a distribuição é desigual (o país maior domina).

**Round-robin**: distribui sequencialmente, ignorando o conteúdo. Distribuição perfeitamente uniforme, zero localidade. Útil apenas quando não há chave de acesso dominante.

**A decisão de chave de particionamento é a decisão mais consequente de um sistema distribuído de dados**, e é difícil de reverter. Três critérios, e eles frequentemente conflitam:

1. **Cardinalidade suficiente**: precisa haver valores distintos bastantes para gerar partições em número adequado ao paralelismo.
2. **Distribuição uniforme**: nenhum valor pode concentrar uma fração grande dos dados.
3. **Alinhamento com o padrão de consulta**: se você filtra por data, particionar por data permite pruning; particionar por outra coisa força varredura completa.

Um erro clássico: particionar por `user_id` porque "é a chave natural". Se a maioria das consultas filtra por data, você perdeu o pruning, e além disso criou milhões de partições minúsculas — o problema de small files (ver arquivo 07).

Outro ponto que rende: **granularidade da partição**. Partições muito grandes matam o paralelismo e o pruning; partições muito pequenas geram overhead de metadados e arquivos pequenos. A regra prática em lakes é mirar partições na casa de centenas de MB a poucos GB, e o número total de partições em milhares, não milhões.

### 1.3 Shuffle — o conceito central de performance

**Shuffle** é a redistribuição de dados entre nós para que registros que precisam ser processados juntos fiquem no mesmo lugar.

Por que é necessário: para somar vendas por cliente, todos os registros de um mesmo cliente precisam estar no mesmo executor. Se estão espalhados, precisam ser movidos. O mesmo vale para join (linhas com a mesma chave precisam se encontrar) e para ordenação global.

**O que dispara shuffle** (vale saber de cor): `GROUP BY`, `JOIN` (exceto broadcast), `DISTINCT`, `ORDER BY` global, `repartition`, window functions com `PARTITION BY` sobre uma chave diferente da atual, e agregações que não podem ser pré-agregadas localmente.

**Por que shuffle é caro** — e a resposta completa tem quatro partes, não uma:
1. **Rede**: os dados atravessam a rede entre nós.
2. **Disco**: o lado que produz (map side) escreve os blocos em disco antes de serem buscados; o lado que consome lê. Isso é I/O adicional em ambos os lados.
3. **Serialização**: os dados precisam ser serializados para transporte e desserializados na chegada — custo de CPU frequentemente subestimado.
4. **Barreira de sincronização**: o estágio seguinte só pode começar quando o shuffle terminar. Uma tarefa lenta atrasa todo o estágio (o problema do straggler).

**Como reduzir shuffle:**
- **Broadcast join**: se um lado é pequeno, envie uma cópia dele para todos os executores em vez de redistribuir os dois lados. Elimina o shuffle completamente. É a otimização de maior impacto e a primeira a mencionar.
- **Pré-particionar / bucketing**: se as tabelas estão fisicamente particionadas pela mesma chave de join com o mesmo número de buckets, o join é local — nada se move.
- **Filtrar e projetar antes**: mover menos linhas e menos colunas. Predicate pushdown e column pruning existem para isso.
- **Pré-agregar localmente** (map-side combine): reduzir o volume antes de mandar pela rede. É o que faz `reduceByKey` ser melhor que `groupByKey` no modelo RDD.
- **Reordenar operações**: filtrar antes de juntar, agregar antes de juntar quando a semântica permite.

### 1.4 Data skew — o problema que mais aparece na prática

**Data skew** é a distribuição desigual de dados entre partições. Uma tarefa recebe 100× mais dados que as outras e vira o gargalo do estágio inteiro.

**Como se manifesta:** o job tem 200 tarefas, 199 terminam em 30 segundos e 1 leva 40 minutos. O sintoma na interface é sempre o mesmo — a distribuição de duração das tarefas tem uma cauda longuíssima. Frequentemente a tarefa lenta também estoura memória, porque precisa segurar tudo daquela chave.

**Causas comuns:**
- **Valores naturalmente desbalanceados**: numa plataforma de e-commerce, o cliente "consumidor não identificado" pode ter 40% das transações.
- **NULLs**: se você junta por uma coluna com muitos NULLs, todos os NULLs vão para a mesma partição de hash (dependendo do engine).
- **Valores default/sentinela**: `-1`, `0`, `'UNKNOWN'`, `'N/A'` concentram milhões de linhas.
- **Distribuição de cauda longa genuína**: leis de potência são a norma em dados de comportamento — poucos usuários geram a maior parte dos eventos.
- **Chave de partição com cardinalidade baixa**: particionar por `pais` quando 80% do negócio está num país.

**Como diagnosticar:** olhar a distribuição de duração e de bytes lidos por tarefa (não a média — a média esconde skew; olhe o máximo versus a mediana). E, no dado, um `GROUP BY chave ORDER BY COUNT(*) DESC LIMIT 20` sobre a chave de join revela imediatamente se há concentração.

**Como resolver** (em ordem do mais simples ao mais invasivo):

1. **AQE / skew join automático.** Engines modernas detectam partições anormalmente grandes em tempo de execução e as dividem automaticamente. No Spark, isso está ativo por padrão desde a 3.2 e resolve boa parte dos casos sem intervenção. Mencionar isso primeiro mostra que você está atualizado.
2. **Broadcast join.** Se o lado pequeno couber na memória dos executores, o skew do lado grande deixa de importar — não há redistribuição por chave.
3. **Filtrar o problema.** Se os NULLs ou o sentinela não têm significado para o join, remova-os antes. É a solução mais barata e frequentemente a correta.
4. **Salting.** Adicione um sufixo aleatório à chave do lado skewed (`chave_0`, `chave_1`, ... `chave_N`), e replique o lado pequeno N vezes com todos os sufixos. Isso quebra a chave quente em N partições. Custo: o lado replicado cresce N vezes, e a lógica fica mais complexa. É a solução clássica quando as anteriores não servem.
5. **Separar e tratar em dois caminhos.** Processe as chaves quentes de um jeito (broadcast, agregação separada) e o resto normalmente, unindo os resultados no fim. Mais trabalhoso, mas às vezes é o único jeito.
6. **Mudar a chave de particionamento** ou o modelo de dados. A solução estrutural, cara e às vezes a correta.

### 1.5 Teorema CAP — e por que a formulação popular está errada

**Enunciado:** num sistema distribuído sujeito a **partição de rede** (P), você precisa escolher entre **consistência** (C) e **disponibilidade** (A).

- **Consistency** aqui significa **linearizabilidade**: toda leitura vê a escrita mais recente confirmada. Não é o "C" de ACID.
- **Availability** significa que toda requisição a um nó **não falho** recebe resposta (não necessariamente a mais atual).
- **Partition tolerance** significa continuar operando quando mensagens entre nós se perdem ou atrasam.

**O erro que quase todo candidato comete:** dizer "escolha 2 de 3". Isso está errado, e entrevistadores bons usam essa pergunta exatamente para pegar quem decorou.

Partição de rede **não é uma escolha** — é um fato da natureza. Cabos caem, switches falham, datacenters se isolam. Um sistema distribuído que "escolhe CA" está apenas escolhendo se comportar mal quando a partição inevitavelmente acontecer. A escolha real, e só vale **durante** uma partição, é: continuar respondendo com risco de dado desatualizado ou divergente (AP), ou recusar respostas para preservar a consistência (CP).

Exemplos concretos:
- **CP**: um banco de dados que, ao perder quórum, para de aceitar escritas. Preferir indisponibilidade a inconsistência. É o que você quer para saldo bancário.
- **AP**: um sistema que aceita escritas em ambos os lados da partição e reconcilia depois (last-write-wins, CRDTs, vector clocks). É o que você quer para um carrinho de compras ou para um contador de curtidas.

E o mais importante: essa é uma escolha **por operação**, não por sistema. Muitos bancos modernos permitem escolher o nível de consistência por consulta. Dizer isso é o que transforma uma resposta correta numa resposta excelente.

**PACELC** é a extensão que vale citar e que muita gente não conhece: *se* há **P**artição, escolha entre **A**vailability e **C**onsistency; **E**lse (em operação normal, sem partição), escolha entre **L**atência e **C**onsistência.

PACELC é mais útil que CAP na prática, porque partições são raras e o trade-off latência versus consistência é **contínuo, todo dia**. Toda vez que você usa uma réplica de leitura, está trocando consistência por latência e por escala — e isso não tem nada a ver com partição de rede. Um candidato que traz PACELC espontaneamente sinaliza leitura séria.

### 1.6 Modelos de consistência

Um espectro, do mais forte ao mais fraco:

- **Linearizabilidade (strong)**: o sistema se comporta como se houvesse uma única cópia e as operações acontecessem instantaneamente numa ordem global. Mais caro; exige coordenação em cada operação.
- **Serializabilidade**: propriedade de transações — o resultado equivale a alguma execução serial. É sobre transações; linearizabilidade é sobre operações individuais em objetos. **Strict serializability** combina as duas.
- **Consistência causal**: operações causalmente relacionadas são vistas na mesma ordem por todos; operações concorrentes podem ser vistas em ordens diferentes. Bom equilíbrio, e suficiente para muitos casos (evita "ver a resposta antes da pergunta").
- **Read-your-writes**: você sempre vê suas próprias escritas. Uma garantia de sessão, barata e que resolve a maior parte da percepção de bug pelo usuário.
- **Eventual**: sem novas escritas, todas as réplicas convergem eventualmente. Diz muito pouco — não diz quando, nem o que você vê nesse meio-tempo.

**Read-your-writes é a garantia mais subestimada.** A maior parte do que usuários percebem como bug em sistemas eventualmente consistentes é: "editei meu perfil, recarreguei, voltou o antigo". Garantir sessão consistente resolve isso sem pagar o preço de linearizabilidade global.

Em contexto analítico, o modelo relevante costuma ser **snapshot isolation**: cada consulta vê um estado consistente da tabela num ponto no tempo, mesmo que escritas estejam acontecendo. É exatamente o que formatos de tabela como Iceberg e Delta oferecem, e é a garantia certa para analytics — você não precisa de linearizabilidade, precisa que o relatório não misture estados.

### 1.7 Replicação

**Por que replicar:** disponibilidade (sobreviver à perda de um nó), throughput de leitura (distribuir consultas), e proximidade geográfica (reduzir latência).

**Modelos:**

- **Single-leader (primary-replica)**: todas as escritas vão para um nó, que propaga para réplicas. Simples, evita conflitos de escrita por construção. Limitações: o líder é gargalo de escrita, e a eleição de novo líder em falha é um momento delicado.
- **Multi-leader**: vários nós aceitam escrita e replicam entre si. Bom para multi-região e operação offline. O custo é **resolução de conflito**, que é um problema genuinamente difícil e frequentemente sem solução automática satisfatória.
- **Leaderless (Dynamo-style)**: cliente escreve em N nós e lê de N nós, usando quóruns. Com `W + R > N` você garante interseção entre o conjunto que escreveu e o que leu, o que dá leitura atualizada. Flexível: ajustar W e R desloca o trade-off entre latência de leitura e de escrita.

**Síncrona vs assíncrona** é o trade-off mais importante aqui. Replicação síncrona confirma a escrita só depois que a réplica confirmou: nenhum dado perdido em falha do líder, mas a latência de escrita passa a incluir a réplica, e se a réplica cair, as escritas travam. Assíncrona confirma imediatamente: rápida, mas há uma janela em que dados confirmados ao cliente ainda não estão na réplica — e se o líder morrer nessa janela, esses dados se perdem. Muitos sistemas usam **semi-síncrona**: síncrona para uma réplica, assíncrona para as demais.

**Replication lag** é o que gera as anomalias que usuários percebem: ler de uma réplica atrasada logo depois de escrever no líder devolve o valor antigo. As soluções de sessão (ler do líder por um período após escrever, ou rastrear a posição do log) existem exatamente para isso.

### 1.8 Consenso e coordenação

**Consenso** é fazer múltiplos nós concordarem sobre um valor, mesmo com falhas. É o que sustenta eleição de líder, commit distribuído e configuração replicada.

Algoritmos: **Paxos** (o clássico, notoriamente difícil de implementar), **Raft** (equivalente em garantias, projetado para ser compreensível — usado no etcd, no CockroachDB e no **KRaft** do Kafka, que substituiu o ZooKeeper a partir do Kafka 4.0), **ZAB** (do ZooKeeper).

Duas coisas que valem saber:

**Consenso exige maioria (quórum).** Com N nós, você tolera a falha de ⌊(N−1)/2⌋. Por isso clusters de consenso têm número ímpar de membros: 3 tolera 1, 5 tolera 2. Adicionar um quarto nó a um cluster de 3 não aumenta a tolerância — só aumenta o custo de coordenação. Essa é uma pergunta de entrevista frequente e específica.

**Consenso é caro, então evite-o no caminho quente.** Sistemas bem projetados usam consenso para metadados e coordenação (quem é o líder, qual é a configuração, qual é o commit da tabela) e mantêm o fluxo de dados fora dele. É exatamente o desenho do Kafka: consenso para metadados via KRaft, e o caminho de dados replicado por um protocolo mais leve baseado em ISR.

**FLP impossibility** é o resultado teórico de fundo: em um sistema assíncrono com pelo menos uma falha possível, não existe algoritmo de consenso determinístico que sempre termine. Na prática, algoritmos reais contornam isso com timeouts e aleatoriedade — o que significa que eles são "corretos sempre, terminam quase sempre". Citar isso não é obrigatório, mas mostra profundidade se a conversa for para esse lado.

### 1.9 Tolerância a falhas em processamento distribuído

**Falha de tarefa** é rotina, não exceção. Frameworks lidam com retry automático em outro nó. Isso funciona apenas se a tarefa for **determinística e sem efeito colateral** — outra manifestação de idempotência.

**Straggler** (tarefa anormalmente lenta) é diferente de falha e mais insidioso: a tarefa não morre, só demora. Como o estágio só termina quando a última tarefa termina, um straggler atrasa tudo. Mitigação clássica: **execução especulativa** — o framework dispara uma cópia da tarefa lenta em outro nó e usa o primeiro resultado. Funciona bem quando a lentidão é do nó (disco degradado, contenção); **não** resolve quando a causa é skew, porque a cópia recebe os mesmos dados e demora igual. Distinguir isso é um bom sinal numa entrevista.

**Lineage vs checkpoint**: o Spark rastreia a linhagem das transformações e, se uma partição se perde, recomputa a partir da origem. Elegante, mas se a cadeia for longa, recomputar custa caro — daí a existência de checkpoint, que trunca a linhagem persistindo o resultado intermediário.

**Backpressure**: quando o consumidor não acompanha o produtor, o sistema precisa sinalizar para desacelerar em vez de acumular até estourar memória. Sistemas de streaming implementam isso; ausência de backpressure é causa comum de OOM em pipelines.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. O que é particionamento e por que é necessário?**

*Resposta modelo:* É dividir um dataset em fatias que podem ser armazenadas e processadas independentemente. Necessário por três motivos: o dado não cabe numa máquina, uma máquina não dá conta da carga, ou você precisa sobreviver à falha de uma máquina. Em processamento, é o que permite paralelismo — cada partição vira uma unidade de trabalho. E em leitura, permite **partition pruning**: se você filtra por uma coluna de partição, o engine pula os arquivos irrelevantes sem lê-los.

---

**🟢 P2. Qual a diferença entre particionar por range e por hash?**

*Resposta modelo:* Range agrupa valores contíguos numa mesma partição — bom para consultas por intervalo, especialmente temporais, porque permite pruning eficiente. O problema é hotspot: se todo mundo escreve dados de hoje, uma partição concentra toda a carga de escrita.

Hash distribui uniformemente aplicando uma função sobre a chave — elimina hotspot, mas destrói a localidade, então consulta por intervalo precisa varrer tudo.

Na prática o padrão mais comum é híbrido: range por tempo, e hash dentro de cada período, para ter pruning temporal com distribuição uniforme dentro dele.

---

**🟢 P3. O que é shuffle e por que é caro?**

*Resposta modelo:* Shuffle é a redistribuição de dados entre nós para que registros que precisam ser processados juntos fiquem no mesmo lugar — necessário em `GROUP BY`, `JOIN`, `DISTINCT` e ordenação global.

É caro por quatro razões: os dados atravessam a rede, que é ordens de grandeza mais lenta que memória; o lado produtor escreve blocos em disco e o consumidor os lê, adicionando I/O nos dois lados; há custo de serialização e desserialização; e é uma barreira de sincronização — o próximo estágio só começa quando o shuffle inteiro terminar, então uma tarefa lenta atrasa tudo.

---

**🟢 P4. O que é data skew?**

*Resposta modelo:* É quando os dados se distribuem de forma desigual entre partições, fazendo uma tarefa receber muito mais trabalho que as outras. O sintoma típico é 199 de 200 tarefas terminando em segundos e uma levando dezenas de minutos, frequentemente estourando memória. As causas mais comuns são valores naturalmente concentrados, NULLs numa chave de join, valores sentinela tipo `-1` ou `'UNKNOWN'`, e distribuições de cauda longa, que são a norma em dados de comportamento.

---

### 🟡 Intermediário

**🟡 P5. Como você diagnostica e resolve data skew?**

*Resposta modelo:* Diagnóstico primeiro: olho a distribuição de duração e de bytes por tarefa, comparando o máximo com a mediana — a média esconde skew. E no dado, um `GROUP BY` na chave de join ordenado por contagem revela na hora se há concentração.

Para resolver, vou do mais barato ao mais invasivo. Primeiro verifico se o AQE está ativo — engines modernas detectam partições anormalmente grandes em runtime e as dividem sozinhas, e isso resolve boa parte dos casos. Depois, se um dos lados do join couber em memória, forço broadcast: sem redistribuição por chave, o skew deixa de importar. Terceiro, verifico se o problema são NULLs ou valores sentinela sem significado — nesse caso filtro antes, que é a solução mais barata e frequentemente a correta.

Se nada disso serve, aplico salting: adiciono um sufixo aleatório à chave do lado concentrado e replico o lado pequeno com todos os sufixos, quebrando a chave quente em N partições. O custo é replicar o lado pequeno N vezes e complicar a lógica. A alternativa é separar os caminhos: tratar as chaves quentes de um jeito e o resto normalmente, unindo no fim.

Estruturalmente, se o skew é recorrente, reconsidero a chave de particionamento ou o modelo.

---

**🟡 P6. Explique o teorema CAP.**

*Resposta modelo:* Diz que, sob partição de rede, você escolhe entre consistência — no sentido de linearizabilidade, toda leitura vê a última escrita confirmada — e disponibilidade, no sentido de todo nó não falho responder.

O ponto que costuma ser dito errado é "escolha 2 de 3". Partição de rede não é uma escolha, é um fato: cabos caem. Um sistema que se diz "CA" só está escolhendo se comportar mal quando a partição acontecer. A escolha real existe apenas **durante** a partição: continuar respondendo com risco de divergência, ou recusar para preservar consistência.

E é uma escolha por operação, não por sistema — muitos bancos deixam escolher o nível de consistência por consulta. Para saldo bancário você quer CP; para carrinho de compras ou contador de curtidas, AP com reconciliação.

*Follow-up esperado:* "Conhece PACELC?" → Sim, e acho mais útil na prática: se há Partição, escolha entre Availability e Consistency; senão (Else), escolha entre Latência e Consistência. Partições são raras; o trade-off latência versus consistência acontece todo dia. Toda vez que você lê de uma réplica, está fazendo essa troca, e isso não tem nada a ver com partição de rede.

---

**🟡 P7. Como você escolheria a chave de particionamento de uma tabela grande?**

*Resposta modelo:* Três critérios que frequentemente conflitam, então é uma negociação.

**Alinhamento com o padrão de consulta**: se 90% das consultas filtram por data, particionar por data dá pruning e é o maior ganho disponível. Particionar por algo que ninguém filtra não serve para nada.

**Distribuição uniforme**: nenhum valor pode concentrar uma fração grande. Particionar por `pais` num negócio concentrado em um país cria skew garantido.

**Cardinalidade adequada à granularidade**: cardinalidade baixa demais mata o paralelismo; alta demais gera milhões de partições minúsculas, com overhead de metadados e o problema de small files. Miro partições de centenas de MB a poucos GB, e milhares de partições, não milhões.

Quando os critérios conflitam, uso particionamento composto: range por tempo para pruning, hash de uma chave de alta cardinalidade dentro do período para uniformidade. E, se o engine suportar, prefiro clustering/z-ordering para a segunda dimensão em vez de aninhar mais um nível de partição física.

Uma coisa que eu verificaria antes de decidir é o padrão real de consulta nos logs, não o que as pessoas dizem que consultam. E lembraria que essa decisão é cara de reverter — embora formatos como Iceberg permitam partition evolution sem reescrever o histórico, o que reduz o risco.

---

**🟡 P8. O que é quórum e por que clusters de consenso têm número ímpar de nós?**

*Resposta modelo:* Quórum é o número mínimo de nós que precisa concordar para uma decisão valer, tipicamente a maioria. Com N nós, a maioria é ⌊N/2⌋+1, e você tolera a falha de ⌊(N−1)/2⌋.

Número ímpar porque, com 3 nós, a maioria é 2 e você tolera 1 falha; com 4 nós, a maioria é 3 e você continua tolerando só 1. O quarto nó não aumenta a tolerância, apenas o custo de coordenação e a chance de haver alguma falha. Então 3, 5 e 7 são as configurações racionais.

A maioria também é o que impede split-brain: dois lados de uma partição não podem ambos ter maioria, então no máximo um lado continua operando.

---

**🟡 P9. Qual a diferença entre replicação síncrona e assíncrona?**

*Resposta modelo:* Síncrona confirma a escrita ao cliente só depois que a réplica confirmou. Garante que nada confirmado se perde numa falha do líder, ao custo de a latência de escrita incluir a réplica — e se a réplica ficar indisponível, as escritas travam.

Assíncrona confirma imediatamente e propaga depois. Latência baixa e o líder não depende da saúde das réplicas, mas existe uma janela em que dados já confirmados ao cliente ainda não chegaram — se o líder morrer nela, esses dados se perdem.

O meio-termo comum é semi-síncrona: síncrona para uma réplica e assíncrona para as demais, garantindo durabilidade em duas cópias sem esperar todas.

O efeito colateral prático da assíncrona é replication lag: ler de uma réplica logo após escrever no líder pode devolver o valor antigo. É por isso que garantias de sessão como read-your-writes existem — elas resolvem a percepção de bug do usuário sem exigir consistência forte global.

---

### 🔴 Avançado

**🔴 P10. Um job Spark tem 200 tarefas; 199 terminam em 30 segundos e uma leva 40 minutos e estoura memória. Diagnóstico e solução.**

*Resposta modelo:* O padrão é inequívoco: skew numa chave. A tarefa lenta recebeu uma fração enorme dos dados. Nem execução especulativa nem aumentar memória resolvem a causa — especulação dispararia uma cópia que recebe os mesmos dados e demora igual, e mais memória só adia o estouro.

Investigação: olho os bytes lidos pela tarefa lenta versus a mediana — se a razão é de duas ordens de grandeza, está confirmado. Depois identifico a chave, com um `GROUP BY` na chave de shuffle ordenado por contagem. Na esmagadora maioria das vezes, o culpado é NULL ou um valor sentinela.

Solução em ordem: se for NULL ou sentinela sem significado semântico, filtro ou substituo por uma chave aleatória antes do join — resolve na hora e é gratuito. Se for uma chave de negócio legítima e o outro lado for pequeno, forço broadcast join e elimino o shuffle. Se o AQE estiver desligado, ligo — o skew join adaptativo divide a partição grande automaticamente e é a solução de menor esforço.

Se a chave é legítima e nenhum lado é pequeno, aplico salting: replico o lado menor N vezes com sufixos e adiciono sufixo aleatório do lado grande, o que espalha a chave quente por N tarefas. Escolho N pela razão entre a chave quente e a mediana.

E aproveitaria para verificar se o skew é sintoma de um problema de modelagem — uma entidade "catch-all" concentrando 40% das transações costuma indicar que a modelagem está misturando casos que deveriam ser separados.

---

**🔴 P11. Você precisa fazer join entre uma tabela de 5 TB e outra de 200 GB. Como o engine faz isso e o que você pode otimizar?**

*Resposta modelo:* Nenhuma das duas cabe em memória de um executor, então broadcast está fora por padrão e o engine vai escolher entre sort-merge join e shuffle hash join. Em ambos os casos, os dois lados são shuffleados pela chave de join, o que significa mover 5,2 TB pela rede — é aí que o custo está.

O que eu tentaria, em ordem de impacto:

**Reduzir o que se move.** Filtrar e projetar antes do join: se a consulta só usa 6 das 80 colunas e filtra 90% das linhas por data, aplicar isso antes reduz o volume drasticamente. Verificar se predicate pushdown e partition pruning estão realmente acontecendo no plano — frequentemente não estão, por causa de uma função aplicada na coluna de partição ou por incompatibilidade de tipo.

**Reduzir o lado pequeno até caber em broadcast.** 200 GB não cabe, mas 200 GB *depois de filtrar e projetar* pode virar 2 GB. Essa é a otimização com maior retorno e a mais frequentemente esquecida.

**Dynamic partition pruning.** Se a tabela grande é particionada por uma coluna e o join com a menor restringe os valores dessa coluna, engines modernas conseguem podar partições da tabela grande em runtime, com base no resultado do lado menor. Isso pode eliminar a maior parte do I/O.

**Bucketing / co-particionamento.** Se esse join é recorrente, escrever as duas tabelas particionadas fisicamente pela chave de join com o mesmo número de buckets elimina o shuffle permanentemente. Custa reescrever as tabelas uma vez e disciplina para manter, e só compensa se o padrão for estável.

**Verificar skew na chave de join**, pelas razões da pergunta anterior.

E antes de tudo isso, eu questionaria se o join precisa ser nesse grão — frequentemente pré-agregar um dos lados antes do join reduz o problema em uma ordem de grandeza e é semanticamente equivalente.

---

**🔴 P12. Explique por que "eventual consistency" muitas vezes não é suficiente, e o que você usaria no lugar.**

*Resposta modelo:* Consistência eventual afirma que, sem novas escritas, as réplicas convergem. O problema é o que ela **não** afirma: não diz em quanto tempo, nem o que você observa nesse meio-tempo. Na prática isso permite anomalias que usuários percebem como bug: ler o valor antigo logo depois de escrever; ver um valor, recarregar e ver outro mais antigo (leituras não monotônicas); ou ver uma resposta antes da pergunta que a originou (violação de causalidade).

Antes de saltar para consistência forte, que é cara, eu escalonaria:

**Read-your-writes** resolve a maior parte da percepção de bug: garanta que a sessão que escreveu sempre veja sua própria escrita, lendo do líder por um período ou rastreando a posição no log. Barato e de altíssimo retorno.

**Leituras monotônicas** garantem que você nunca vê o tempo andar para trás — normalmente fixando a sessão numa réplica.

**Consistência causal** garante que operações causalmente relacionadas apareçam na ordem certa para todos, permitindo divergência apenas entre operações genuinamente concorrentes. É um ponto de equilíbrio muito bom.

**Linearizabilidade** só onde há invariante de negócio que não pode ser violada: saldo que não pode ficar negativo, unicidade de um identificador, reserva de estoque limitado.

Em contexto analítico, a garantia que importa normalmente não é nenhuma dessas: é **snapshot isolation** — cada consulta enxerga um estado consistente da tabela num ponto no tempo, mesmo com escritas concorrentes. É o que formatos de tabela transacionais oferecem, e é suficiente, porque o problema em analytics não é ler valor antigo, é ler uma mistura de estados no meio de uma escrita.

---

**🔴 P13. Como funciona a tolerância a falhas no Spark, e qual a diferença entre lineage e checkpoint?**

*Resposta modelo:* O Spark rastreia a **linhagem** de cada dataset: a sequência de transformações determinísticas que o produziu a partir de dados de entrada. Se uma partição se perde porque um executor morreu, ele recomputa apenas aquela partição reaplicando a linhagem. Isso é elegante porque não exige replicar dados intermediários.

O problema é que linhagem longa fica cara: se a cadeia tem 30 estágios e você perde uma partição no final, recomputar significa refazer muito trabalho — e em pipelines iterativos, a linhagem cresce sem limite.

**Checkpoint** trunca a linhagem: persiste o resultado num storage confiável e passa a tratá-lo como fonte, descartando o histórico de transformações. Custa I/O, então você paga adiantado para evitar recomputação cara depois. Uso quando a linhagem é longa, quando o dataset é reutilizado várias vezes, ou em jobs de streaming, onde checkpoint tem também o papel de guardar offsets e estado.

`cache`/`persist` é diferente e frequentemente confundido: guarda o dataset em memória ou disco local do executor para reutilização, mas **mantém** a linhagem, porque o cache pode ser perdido junto com o executor. Cache é otimização de performance; checkpoint é garantia de recuperação.

Vale acrescentar que tudo isso só funciona porque as transformações são determinísticas e sem efeito colateral. Se o código faz chamada externa ou usa aleatoriedade sem semente fixa, a recomputação pode produzir resultado diferente — e o modelo de recuperação silenciosamente deixa de ser correto.

---

**🔴 P14. O que é execução especulativa e quando ela não ajuda?**

*Resposta modelo:* É o framework detectar uma tarefa anormalmente lenta em relação às outras do mesmo estágio e disparar uma cópia dela em outro nó, usando o resultado do que terminar primeiro e cancelando o outro. Existe para mitigar stragglers, que são um problema real em clusters grandes: como o estágio só termina quando a última tarefa termina, um nó degradado atrasa tudo.

Ela ajuda quando a lentidão é **do nó**: disco falhando, contenção de recursos com outro job, rede degradada, nó com hardware mais fraco. A cópia roda num nó saudável e termina rápido.

Não ajuda — e piora — quando a lentidão é **dos dados**. No caso de skew, a cópia recebe exatamente a mesma partição gigante e demora o mesmo tempo, e agora você está consumindo o dobro de recursos para o mesmo resultado. Também não ajuda se a tarefa é lenta por um gargalo compartilhado, como um sink externo com rate limit — a cópia disputa o mesmo gargalo.

E há um risco importante: especulação **duplica execução**. Se a tarefa tiver efeito colateral não idempotente, como escrever direto num sistema externo, você pode gerar escrita duplicada. É por isso que frameworks usam commit protocols com escrita em local temporário e rename atômico — e por isso sinks customizados precisam ser desenhados com isso em mente.

---

**🔴 P15. Um sistema precisa aceitar escritas em duas regiões geográficas, com baixa latência em ambas. Quais são as implicações?**

*Resposta modelo:* Aceitar escrita em duas regiões com baixa latência local significa que você não pode coordenar sincronamente entre elas — a velocidade da luz impõe dezenas ou centenas de milissegundos de ida e volta, e coordenar em cada escrita mataria a latência. Isso te coloca em multi-leader ou leaderless, e a consequência inevitável é **conflito de escrita**.

As opções para resolver conflito, e nenhuma é gratuita:

**Last-write-wins por timestamp**: simples, mas perde dados silenciosamente e depende de relógios sincronizados, o que é uma premissa frágil. Aceitável para dados onde a última versão é a única que importa e a perda é tolerável.

**CRDTs** (tipos de dados que convergem por construção — contadores, sets, mapas): resolvem conflitos deterministicamente sem coordenação, mas restringem quais operações você pode expressar. Excelentes onde se aplicam.

**Resolução no domínio da aplicação**: guardar as versões conflitantes e deixar a lógica de negócio ou o usuário decidir. É o mais correto e o mais trabalhoso.

**Particionar por região** para evitar o conflito na origem: cada entidade tem uma região "dona" que aceita suas escritas, e as demais regiões leem replicado. Isso elimina conflitos por construção e frequentemente é a resposta certa — a maioria dos negócios tem afinidade geográfica natural, e usuários raramente escrevem de duas regiões ao mesmo tempo.

Eu começaria por essa última e só iria para resolução de conflito no que genuinamente precisa de escrita global. E onde houver invariante forte — estoque limitado, unicidade, saldo — aceitaria pagar a coordenação cross-region, porque nesses casos a consistência não é negociável e o custo de latência é o preço correto. Isso é PACELC na prática: escolhi latência sobre consistência para a maior parte, e o oposto para o núcleo transacional.

---

## 3. Armadilhas comuns

**Dizer "CAP: escolha 2 de 3".** Partição não é escolha. A resposta correta é que a escolha entre C e A só existe durante uma partição, e que é uma decisão por operação, não por sistema.

**Confundir o "C" de CAP com o "C" de ACID.** Em CAP é linearizabilidade; em ACID é preservação de invariantes de integridade pela transação. Não têm relação.

**Achar que mais nós num cluster de consenso é sempre melhor.** 4 nós toleram as mesmas falhas que 3 e coordenam mais devagar. Ímpar sempre.

**Tratar skew como problema de recursos.** Aumentar memória ou número de executores não resolve skew — o gargalo é uma única tarefa com dados demais. Mais recursos só encarecem o mesmo tempo de execução.

**Esquecer NULLs como causa de skew.** É a causa mais comum e a mais fácil de corrigir. Sempre verifique antes de partir para salting.

**Dizer que broadcast join resolve tudo.** Só funciona se um lado couber confortavelmente na memória de cada executor — e a cópia é replicada para todos, então o custo total é o tamanho vezes o número de executores. Broadcast de algo grande demais causa OOM no driver ou nos executores.

**Confundir cache com checkpoint.** Cache mantém a linhagem e pode ser perdido; checkpoint trunca a linhagem e persiste em storage confiável. São ferramentas para problemas diferentes.

**Assumir que particionar mais é sempre melhor.** Milhões de partições geram overhead de metadados, listagem lenta e arquivos pequenos, o que degrada tudo. Existe um ponto ótimo, e ele está mais perto de milhares do que de milhões.

**Ignorar o custo de serialização no shuffle.** Muita gente cita só rede. Serialização e I/O de disco frequentemente dominam, e é por isso que formatos e serializadores eficientes importam.

**Achar que replicação é backup.** Replicação propaga erros: um `DELETE` acidental é replicado em milissegundos para todas as réplicas. Backup e time travel resolvem problemas que replicação não resolve.

**Propor consistência forte por reflexo.** É cara e frequentemente desnecessária. Read-your-writes resolve a maior parte da percepção de problema por uma fração do custo — e em analytics, snapshot isolation é a garantia certa, não linearizabilidade.

**Confundir straggler com falha.** Um nó lento não gera erro; ele só atrasa. Execução especulativa existe para isso, mas não resolve skew — distinguir os dois casos é o que a pergunta está testando.
