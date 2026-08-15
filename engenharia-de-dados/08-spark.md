# 08 — Apache Spark

> Arquitetura · Lazy evaluation e DAG · Transformações wide e narrow · Catalyst e Tungsten · AQE · Joins · Memória · Tuning e diagnóstico

---

## 1. Resumo conceitual

### 1.1 Arquitetura

Um job Spark tem três papéis:

**Driver.** Executa o programa principal, constrói o plano lógico, o otimiza, quebra em estágios e tarefas, e as agenda nos executores. Mantém o `SparkContext`/`SparkSession` e coleta resultados. É um ponto único de falha: se o driver morre, o job morre. Também é onde o `collect()` traz dados — motivo pelo qual `collect()` sobre um dataset grande estoura a memória do driver e é um erro clássico.

**Cluster manager.** Aloca recursos: YARN, Kubernetes, Standalone, ou o gerenciador do serviço gerenciado. O Spark não gerencia máquinas, ele pede recursos.

**Executors.** Processos JVM nos nós de trabalho que executam as tarefas e mantêm dados em cache. Cada executor tem um número de **cores** (tarefas simultâneas) e uma quantidade de memória.

Hierarquia de execução, e é importante saber nomear corretamente:

- **Job**: disparado por uma **ação** (`count`, `write`, `collect`).
- **Stage**: um conjunto de tarefas que pode rodar sem shuffle. **As fronteiras entre estágios são exatamente os shuffles.**
- **Task**: a unidade mínima — uma tarefa processa **uma partição**. O número de tarefas de um estágio é o número de partições.

Daí decorre a relação que responde muitas perguntas: **paralelismo efetivo = min(número de partições, total de cores disponíveis)**. Se você tem 100 cores e 10 partições, 90 cores ficam ociosos. Se tem 10 cores e 10.000 partições minúsculas, o overhead de agendamento domina.

### 1.2 Lazy evaluation e o DAG

Transformações (`map`, `filter`, `join`, `groupBy`) **não executam nada**. Elas constroem um plano — o DAG de operações. Só uma **ação** (`count`, `collect`, `write`, `show`) dispara a execução.

**Por que isso é bom:**
- Permite ao otimizador **ver a query inteira** antes de decidir. Ele pode reordenar filtros, combinar operações, eliminar colunas não usadas e escolher algoritmos de join com base no plano completo.
- Permite **fundir operações** (pipelining): dois `filter` seguidos e um `map` viram uma única passada sobre os dados, sem materializar intermediários.
- Evita computar o que não é necessário.

**Consequências práticas que caem em entrevista:**
- Erros aparecem só na ação, não na linha que os causou — o que torna o debug menos intuitivo.
- **Um DataFrame não é um resultado, é uma receita.** Se você usa o mesmo DataFrame em duas ações, ele é recomputado inteiro nas duas, a menos que você faça `cache`/`persist`. É a causa número um de jobs desnecessariamente lentos.
- `count()` para "verificar" um DataFrame no meio do pipeline dispara a execução completa de tudo que veio antes.

### 1.3 Transformações narrow e wide

**Narrow**: cada partição de saída depende de **uma** partição de entrada. `map`, `filter`, `select`, `union`. Não há movimentação de dados; várias narrow consecutivas são fundidas num único estágio e executadas em uma passada.

**Wide**: cada partição de saída depende de **várias** partições de entrada. `groupByKey`, `reduceByKey`, `join` (não-broadcast), `distinct`, `repartition`, `orderBy`. Exigem **shuffle**, e portanto criam uma fronteira de estágio.

Essa distinção é o vocabulário central para falar de performance em Spark. Otimizar um job é, na prática, reduzir o número e o custo dos shuffles.

**`repartition` vs `coalesce`** — pergunta muito frequente:
- `repartition(n)` faz shuffle completo e produz `n` partições **balanceadas**. Pode aumentar ou diminuir. Caro, mas resolve desbalanceamento.
- `coalesce(n)` **apenas funde** partições existentes, sem shuffle completo. Só diminui. Barato, mas pode deixar partições desbalanceadas.
- O detalhe que separa: `coalesce` reduz o paralelismo **de todo o estágio anterior**, porque não há fronteira de shuffle. Se você faz `coalesce(1)` antes de gravar depois de uma transformação pesada, aquela transformação inteira passa a rodar com paralelismo 1. Nesse caso, `repartition(1)` é mais lento no papel mas frequentemente mais rápido no total, porque preserva o paralelismo até o shuffle final.

**`reduceByKey` vs `groupByKey`** (modelo RDD, mas ainda cobrado): `reduceByKey` faz agregação parcial **no lado do map** antes do shuffle, reduzindo drasticamente o volume trafegado. `groupByKey` move tudo e agrega depois. Para agregações associativas e comutativas, `reduceByKey` é sempre preferível. A API de DataFrame faz essa otimização automaticamente, o que é um dos argumentos para preferir DataFrame a RDD.

### 1.4 Catalyst e Tungsten

**Catalyst** é o otimizador de queries do Spark SQL. Ele opera em quatro fases:

1. **Análise.** Resolve nomes de colunas e tabelas contra o catálogo, valida tipos, produz um plano lógico resolvido.
2. **Otimização lógica.** Aplica regras baseadas em equivalência: predicate pushdown (empurrar filtros para perto da fonte), column pruning (descartar colunas não usadas), constant folding, simplificação de expressões booleanas, eliminação de subconsultas redundantes, reordenação de joins.
3. **Planejamento físico.** Gera planos físicos candidatos — qual algoritmo de join, qual estratégia de agregação — e escolhe por custo, usando estatísticas.
4. **Geração de código (whole-stage codegen).** Compila o estágio inteiro em bytecode JVM otimizado, eliminando chamadas virtuais e materialização de objetos intermediários. Um estágio com vários operadores vira um único loop compilado.

**Tungsten** é a camada de execução de baixo nível: gerenciamento de memória fora do heap (evitando pressão de GC), formato binário compacto para os dados em memória, algoritmos cache-aware de sort e hash, e processamento vetorizado. Catalyst decide *o que* fazer; Tungsten faz *rápido*.

**A implicação prática, e o motivo pelo qual isso cai em entrevista:** RDD não passa por Catalyst — o Spark não consegue enxergar dentro de uma lambda arbitrária. DataFrame e Dataset com expressões SQL passam. Por isso a mesma lógica escrita em DataFrame frequentemente roda muito mais rápido que em RDD. E UDFs em Python são uma **caixa preta** para o Catalyst: ele não consegue otimizar através delas, não consegue empurrar predicados, e além disso há custo de serialização entre a JVM e o processo Python. UDFs vetorizadas (Pandas UDF / Arrow) reduzem o custo de serialização mas continuam opacas ao otimizador. A recomendação padrão é usar funções nativas sempre que possível.

### 1.5 Adaptive Query Execution (AQE)

AQE é otimização em **tempo de execução**, usando estatísticas reais coletadas durante o job em vez de estimativas feitas antes. Introduzido no Spark 3.0 e **ativo por padrão desde a 3.2**.

O problema que resolve: o Catalyst planeja antes de executar, com base em estatísticas que podem estar ausentes, desatualizadas ou impossíveis de estimar (o resultado de um filtro complexo, o efeito de um join encadeado). Estimativas erradas produzem planos ruins. AQE corrige o plano no meio do caminho, entre estágios, quando os números reais já estão disponíveis.

Três otimizações principais:

**Coalescing de partições pós-shuffle.** Depois do shuffle, o AQE olha os tamanhos reais das partições e funde as pequenas contíguas até atingir um tamanho alvo (padrão da ordem de 64 MB, configurável). Isso resolve o problema clássico de `spark.sql.shuffle.partitions` fixo em 200: com dados pequenos você tinha 200 tarefas minúsculas com overhead dominante; agora o número se ajusta sozinho.

**Conversão de sort-merge join em broadcast join.** Se, após executar os estágios anteriores, um lado do join acabou sendo pequeno o suficiente, o AQE troca a estratégia e elimina o shuffle. É particularmente valioso quando o tamanho só é conhecido depois de um filtro seletivo.

**Skew join optimization.** Detecta partições anormalmente grandes em relação à mediana e as divide em sub-partições, replicando o lado correspondente. Resolve automaticamente boa parte dos casos de skew que antes exigiam salting manual.

Numa entrevista, mencionar que o AQE está ligado por padrão desde a 3.2 e que ele resolve automaticamente muito do que antigamente era tuning manual mostra que você está atualizado — e é uma boa resposta ao ser perguntado "como você resolve skew".

### 1.6 Estratégias de join

- **Broadcast Hash Join**: o lado pequeno é enviado inteiro a todos os executores; join local, sem shuffle. Controlado por `spark.sql.autoBroadcastJoinThreshold` (padrão na casa de 10 MB) ou por hint explícito. É a melhor opção quando cabe. O risco é OOM se o lado transmitido for maior do que se estimou.
- **Shuffle Hash Join**: ambos os lados são shuffleados pela chave; constrói hash table por partição. Sem ordenação, mas exige memória para a hash table.
- **Sort Merge Join**: ambos shuffleados e ordenados, depois merge. É o padrão para dois lados grandes. Mais robusto quanto a memória (pode fazer spill de forma graciosa), mais caro em CPU pela ordenação.
- **Broadcast Nested Loop Join**: fallback para condições que não são de igualdade. Custo quadrático — se aparecer no plano para tabelas grandes, é um sinal de alerta, normalmente indicando condição de join mal escrita.

**Dynamic Partition Pruning (DPP):** quando uma fato particionada é juntada com uma dimensão filtrada, o Spark consegue derivar em runtime quais partições da fato podem ser podadas, com base nos valores que sobraram na dimensão. Pode eliminar a maior parte do I/O em modelos star schema. É uma das otimizações de maior impacto em warehouse sobre Spark, e vale citar.

### 1.7 Memória e configuração

A memória de um executor se divide em:

- **Reserved memory**: uma fatia fixa para o próprio Spark.
- **Unified memory** (fração configurável do restante, padrão 0,6), dividida entre:
  - **Execution memory**: shuffle, sort, hash tables de join, agregações.
  - **Storage memory**: dados em cache.
  - As duas se emprestam mutuamente: execução pode expulsar blocos de cache quando precisa, mas cache não expulsa execução.
- **User memory**: estruturas de dados do código do usuário.
- **Overhead** (fora do heap): buffers de rede, off-heap do Tungsten, e — importante em PySpark — a memória dos processos Python, que **não** vive no heap da JVM. Jobs PySpark que estouram memória frequentemente precisam de mais overhead, não de mais heap.

**Configurações que realmente importam** (e por quê):

- `spark.sql.shuffle.partitions`: número de partições após shuffle. O padrão histórico é 200, o que é errado para quase todo mundo — pequeno demais para dados grandes, grande demais para dados pequenos. Com AQE, o coalescing corrige o excesso automaticamente, mas o valor inicial ainda importa como teto.
- `spark.sql.autoBroadcastJoinThreshold`: limite para broadcast. Aumentar pode dar ganhos grandes; aumentar demais causa OOM.
- Número de cores por executor: valores muito altos (acima de ~5) tendem a sofrer com contenção de I/O e GC; muito baixos desperdiçam overhead de JVM por executor. A faixa de 3 a 5 cores por executor é a heurística usual.
- Memória por executor: executores gigantes têm pausas de GC longas. Vários executores médios costumam ser melhores que poucos enormes.
- `spark.sql.files.maxPartitionBytes`: quanto cada partição lê da fonte, o que determina o paralelismo inicial.

**Spill** é o conceito prático mais útil: quando execution memory não basta, o Spark escreve em disco para continuar. O job não falha, apenas fica muito mais lento. Spill visível na interface é um dos sinais mais confiáveis de que há pressão de memória ou partições grandes demais.

### 1.8 Cache, persist e checkpoint

**`cache()` / `persist()`** guardam o resultado para reutilização. Níveis: só memória, memória e disco, serializado (menos espaço, mais CPU), com replicação. O padrão para DataFrame é `MEMORY_AND_DISK`.

**Quando cachear:** quando o mesmo DataFrame é usado por **múltiplas ações** e recomputá-lo é caro. Fora disso, cache é contraproducente: consome memória que a execução precisa, e pode causar spill ou expulsão de dados úteis.

**Erro comum:** cachear um DataFrame usado uma única vez. Não há ganho — apenas custo de escrita no cache e memória ocupada.

**`checkpoint()`** persiste em storage confiável e **trunca a linhagem**. Cache mantém a linhagem (porque o cache pode ser perdido junto com o executor); checkpoint a descarta. Use quando a linhagem ficou longa demais — típico em loops iterativos, onde o plano cresce a cada iteração até o driver ter dificuldade só para planejar.

### 1.9 Spark Structured Streaming — o essencial

Modelo conceitual: o stream é tratado como uma **tabela infinita** à qual linhas são acrescentadas, e a query é reexecutada incrementalmente sobre ela. A mesma API de DataFrame serve batch e streaming, o que é a grande vantagem de manutenção.

Pontos que caem:
- **Micro-batch** por padrão (latência de segundos), com modo de baixa latência disponível para casos que precisam de milissegundos e abrem mão de algumas operações.
- **Output modes**: `append` (só linhas novas, o único que funciona para muitas operações), `update` (linhas alteradas), `complete` (o resultado inteiro a cada batch, só viável para agregações pequenas).
- **Checkpoint** guarda offsets e estado; é obrigatório para recuperação e para exactly-once com sinks idempotentes.
- **Watermark** define até quando esperar dados atrasados e permite descartar estado antigo. Sem watermark, agregações por janela retêm estado indefinidamente.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Explique a arquitetura do Spark.**

*Resposta modelo:* Tem três papéis. O driver executa o programa principal, constrói e otimiza o plano, quebra em estágios e tarefas, e as agenda. O cluster manager — YARN, Kubernetes ou standalone — aloca recursos. Os executores são processos JVM que rodam as tarefas e mantêm dados em cache.

A execução se organiza em job (disparado por uma ação), stage (conjunto de tarefas sem shuffle entre elas — as fronteiras de estágio são exatamente os shuffles) e task (a unidade mínima: uma tarefa processa uma partição).

O driver é ponto único de falha, e é onde `collect()` traz os dados — por isso `collect()` num dataset grande estoura a memória do driver.

---

**🟢 P2. O que é lazy evaluation e qual a vantagem?**

*Resposta modelo:* Transformações não executam nada; elas constroem um plano. Só uma ação dispara a execução.

A vantagem é que o otimizador vê a query inteira antes de decidir: ele reordena filtros, elimina colunas não usadas, funde operações numa única passada e escolhe algoritmos de join com base no plano completo. Se cada transformação executasse imediatamente, nada disso seria possível.

A consequência prática é que um DataFrame não é um resultado, é uma receita. Se você o usa em duas ações, ele é recomputado nas duas — a menos que faça cache. Essa é uma das causas mais comuns de job desnecessariamente lento.

---

**🟢 P3. Qual a diferença entre transformação narrow e wide?**

*Resposta modelo:* Narrow é quando cada partição de saída depende de uma única partição de entrada — `map`, `filter`, `select`. Não há movimentação de dados, e várias narrow consecutivas são fundidas num estágio só.

Wide é quando cada partição de saída depende de várias de entrada — `groupBy`, `join`, `distinct`, `orderBy`. Exige shuffle, e portanto cria uma fronteira de estágio.

É a distinção central para falar de performance: otimizar um job Spark é, na prática, reduzir o número e o custo dos shuffles.

---

**🟢 P4. Diferença entre `repartition` e `coalesce`.**

*Resposta modelo:* `repartition(n)` faz shuffle completo e gera n partições balanceadas; pode aumentar ou diminuir o número. `coalesce(n)` apenas funde partições existentes sem shuffle completo; só diminui, e pode deixar partições desbalanceadas.

O detalhe que costuma decidir a resposta: `coalesce` reduz o paralelismo de todo o estágio anterior, porque não há fronteira de shuffle. Se você faz `coalesce(1)` antes de gravar, depois de uma transformação pesada, aquela transformação inteira passa a rodar com uma única task. Nesse caso, `repartition(1)` é mais caro no papel mas normalmente mais rápido no total, porque preserva o paralelismo até o shuffle final.

---

### 🟡 Intermediário

**🟡 P5. O que é o Catalyst e o que ele faz?**

*Resposta modelo:* É o otimizador do Spark SQL, e opera em quatro fases. Análise: resolve nomes contra o catálogo e valida tipos. Otimização lógica: aplica regras de equivalência — predicate pushdown, column pruning, constant folding, simplificação de expressões, reordenação de joins. Planejamento físico: gera candidatos, escolhe algoritmo de join e estratégia de agregação por custo, usando estatísticas. E geração de código: compila o estágio inteiro em bytecode otimizado, eliminando chamadas virtuais e objetos intermediários.

A implicação prática mais importante é que ele só enxerga o que consegue analisar. RDD com lambdas arbitrárias é opaco. UDFs em Python também são caixa preta: o Catalyst não otimiza através delas, não empurra predicados, e ainda há custo de serialização entre JVM e Python. Por isso a recomendação de usar funções nativas e API de DataFrame sempre que possível.

---

**🟡 P6. O que é AQE e quais problemas resolve?**

*Resposta modelo:* Adaptive Query Execution é otimização em tempo de execução: entre estágios, o Spark usa estatísticas reais em vez das estimativas feitas antes de executar. Está ligado por padrão desde a 3.2.

Resolve três coisas. Coalescing de partições pós-shuffle: olha os tamanhos reais e funde as pequenas até um tamanho alvo, o que corrige o problema clássico do `shuffle.partitions` fixo em 200. Conversão de sort-merge em broadcast join, quando um lado acabou sendo pequeno depois de um filtro cujo efeito não era estimável antes. E skew join: detecta partições muito maiores que a mediana e as divide em sub-partições, replicando o outro lado — o que resolve automaticamente boa parte dos casos que antes exigiam salting manual.

O valor conceitual é que ele ataca a causa raiz de planos ruins, que é estimativa de cardinalidade errada.

---

**🟡 P7. Quando você usaria `cache()` e quando não?**

*Resposta modelo:* Cacheio quando o mesmo DataFrame é consumido por **múltiplas ações** e recomputá-lo é caro — típico em pipelines que derivam vários resultados do mesmo intermediário, ou em algoritmos iterativos.

Não cacheio quando o DataFrame é usado uma vez só: não há ganho, só custo de escrita no cache e memória ocupada. E memória ocupada por cache é memória que a execução não tem, o que pode causar spill e deixar o job **mais** lento. Cache indiscriminado é uma das causas de degradação mais comuns que vejo.

Também prefiro não cachear datasets muito maiores que a memória disponível — o cache é parcialmente expulso, e o Spark acaba recomputando partições sem que fique óbvio.

Se a linhagem estiver muito longa, especialmente em loops iterativos onde o plano cresce a cada iteração, uso `checkpoint` em vez de cache: ele persiste em storage confiável e trunca a linhagem, enquanto cache a mantém.

---

**🟡 P8. Quais estratégias de join o Spark tem e como ele escolhe?**

*Resposta modelo:* Broadcast hash join envia o lado pequeno inteiro para todos os executores e faz o join local, sem shuffle — é a melhor opção quando cabe, e é escolhida quando o tamanho estimado fica abaixo do threshold de broadcast. Shuffle hash join shuffleia os dois lados e constrói hash table por partição, sem ordenar. Sort merge join shuffleia e ordena os dois lados e faz merge — é o padrão para dois lados grandes, mais caro em CPU mas mais robusto quanto a memória, porque faz spill graciosamente. E broadcast nested loop join, que é fallback para condições que não são de igualdade, com custo quadrático — se aparecer no plano para tabelas grandes, normalmente indica condição de join mal escrita.

A escolha depende de tamanho estimado, tipo de condição e configuração. E como as estimativas podem estar erradas, o AQE pode trocar a estratégia em runtime.

Vale mencionar também o dynamic partition pruning: ao juntar uma fato particionada com uma dimensão filtrada, o Spark deriva em runtime quais partições da fato podem ser podadas. Em star schema, isso pode eliminar a maior parte do I/O.

---

**🟡 P9. Por que UDFs em Python são desencorajadas?**

*Resposta modelo:* Por dois motivos que se somam.

O primeiro é a opacidade para o Catalyst: uma UDF é uma caixa preta, então o otimizador não pode empurrar predicados através dela, não pode eliminar colunas, e não pode incluí-la na geração de código do estágio. Ela quebra a fusão de operadores.

O segundo é serialização: os dados precisam sair da JVM, ser serializados, atravessar para um processo Python, ser processados, e voltar. Isso custa CPU e memória — e a memória dos processos Python fica fora do heap da JVM, o que é uma causa comum de OOM mal diagnosticado em PySpark.

Pandas UDF, ou UDF vetorizada com Arrow, reduz muito o custo de serialização porque transfere em lote num formato colunar compartilhado, mas continua opaca ao otimizador. A ordem de preferência é: função nativa do Spark SQL primeiro, Pandas UDF se não houver nativa, UDF Python linha a linha como último recurso.

---

### 🔴 Avançado

**🔴 P10. Um job Spark que rodava em 20 minutos passou a levar 3 horas. Como você investiga?**

*Resposta modelo:* Começo pela Spark UI, olhando os estágios em ordem de duração, para localizar onde o tempo foi.

Dentro do estágio lento, olho a **distribuição de duração das tarefas**. Se a mediana é baixa e o máximo é altíssimo, é skew — e aí investigo a chave de shuffle, procurando NULLs ou valores sentinela concentrados. Se todas as tarefas estão uniformemente lentas, é volume, recursos ou I/O.

Verifico **spill** de memória e disco nas métricas do estágio. Spill alto significa pressão de memória: ou as partições cresceram, ou alguém adicionou cache, ou o volume aumentou. É um dos sinais mais confiáveis.

Verifico se o **plano mudou**. A causa mais comum de regressão brusca é a perda de um broadcast join: a tabela que era pequena cresceu e passou do threshold, e o que era broadcast virou sort-merge com shuffle de terabytes. Comparo o plano físico com o histórico.

Verifico **número e tamanho de partições de entrada**. Se a origem passou a ter muitos arquivos pequenos, o paralelismo explode e o overhead domina. Se passou a ter poucos arquivos grandes não splittable, o paralelismo colapsa.

Verifico **tempo de GC**. GC alto indica executores grandes demais, cache excessivo ou objetos intermediários demais.

E verifico o ambiente: contenção com outros jobs no cluster, degradação do storage, mudança de versão do runtime.

O erro que eu evitaria é aumentar recursos antes de diagnosticar. Se a causa é skew, mais executores não mudam nada — a tarefa gargalo continua a mesma, e você só paga mais caro pelo mesmo tempo.

---

**🔴 P11. Você tem um join entre uma tabela de 10 TB e outra de 50 GB. O job falha com OOM. O que faz?**

*Resposta modelo:* Primeiro entendo **onde** o OOM acontece, porque a causa é diferente em cada caso.

**Se é no driver**, quase sempre é uma tentativa de broadcast de algo grande demais — o driver coleta o lado a ser transmitido antes de distribuir — ou um `collect()` indevido no código. Se o Spark está tentando fazer broadcast de 50 GB porque a estimativa de tamanho está errada (comum quando as estatísticas não existem ou quando há compressão), desabilito o broadcast para esse join ou corrijo o threshold.

**Se é nos executores**, as causas prováveis são: partições grandes demais depois do shuffle; skew concentrando dados numa tarefa; ou hash table de shuffle hash join que não cabe.

O que eu faria, em ordem:

**Reduzir o que entra no join.** Filtrar e projetar antes. Frequentemente os 50 GB viram 2 GB depois de aplicar o filtro de data e selecionar só as colunas necessárias — e aí broadcast passa a ser viável, o que elimina o shuffle e resolve tudo. Essa é a intervenção de maior retorno e a mais esquecida.

**Verificar skew**, comparando bytes por tarefa. Se houver, ligar AQE (se estiver desligado) ou aplicar salting.

**Aumentar o número de partições de shuffle**, para que cada tarefa processe menos dados. É o ajuste mais direto contra partição grande demais.

**Forçar sort-merge join** em vez de shuffle hash join, porque ele faz spill de forma graciosa em vez de estourar.

**Ajustar a memória**, incluindo o overhead — especialmente se for PySpark, onde os processos Python vivem fora do heap e o sintoma de falta de overhead é o container ser morto pelo gerenciador de recursos, não um OOM de JVM.

E, se esse join for recorrente, consideraria co-particionar as duas tabelas pela chave (bucketing), o que elimina o shuffle permanentemente ao custo de reescrevê-las uma vez.

---

**🔴 P12. Explique o que acontece quando você chama `df.write.partitionBy("data").parquet(...)` e quais problemas isso pode causar.**

*Resposta modelo:* O Spark escreve os dados em diretórios separados por valor de `data`. Cada task escreve os registros que possui para os diretórios correspondentes às datas presentes na sua partição.

Daí vêm dois problemas.

**Explosão de arquivos.** Se você tem 200 partições em memória e 30 datas distintas, no pior caso são 6.000 arquivos — 200 por data, cada um pequeno. É o mecanismo pelo qual small files surgem em pipelines aparentemente normais. A solução é fazer `repartition("data")` antes de gravar, garantindo que cada data esteja concentrada em poucas tasks, e portanto em poucos arquivos.

**Skew na escrita.** Se `repartition("data")` for feito e uma data tiver muito mais dados que as outras, uma task fica com todo o volume daquela data. O compromisso é `repartition(n, "data")`, que distribui cada data por n tasks — trocando um pouco mais de arquivos por escrita balanceada.

Há ainda dois cuidados. **Cardinalidade da coluna de particionamento**: particionar por algo de alta cardinalidade gera milhões de diretórios com arquivos minúsculos e degrada listagem e planejamento. E **modo de escrita**: `overwrite` com particionamento estático pode apagar a tabela inteira em vez de só as partições afetadas, dependendo da configuração de overwrite dinâmico — é uma armadilha destrutiva e bem conhecida. Em tabelas gerenciadas por formato transacional, prefiro usar as operações do próprio formato, que tratam isso de forma segura e atômica.

---

**🔴 P13. Como você dimensionaria um cluster Spark para um job novo?**

*Resposta modelo:* Não começaria pelo cluster, começaria pelo dado, porque o dimensionamento é derivado dele.

**Volume e paralelismo.** Estimo quantos dados são lidos e quantas partições isso gera. Quero partições na casa de 128 a 256 MB, o que me dá o número de tarefas. O número de cores deve estar na mesma ordem de grandeza do número de tarefas — mais cores que tarefas é desperdício, muito menos significa várias ondas de execução, o que é aceitável mas alonga o job.

**Cores por executor.** Uso a heurística de 3 a 5. Acima disso há contenção de I/O e a JVM sofre; abaixo, o overhead fixo por executor se multiplica.

**Memória por executor.** Estimo pelo maior estado que uma tarefa precisa segurar: a maior partição de shuffle, a hash table do maior join, mais folga para overhead. Prefiro vários executores médios a poucos gigantes, porque executores grandes têm pausas de GC longas e uma falha custa mais trabalho perdido. Em PySpark, reservo overhead adicional explicitamente, porque os processos Python ficam fora do heap.

**Shuffle partitions.** Ajusto para que cada partição pós-shuffle fique na faixa alvo. Com AQE ligado, o coalescing corrige o excesso automaticamente, então errar para mais é mais seguro que errar para menos.

Depois disso, eu **mediria**: rodo com uma amostra representativa, olho a UI e ajusto pelo que aparecer — spill indica falta de memória ou partições grandes; tarefas muito curtas indicam paralelismo excessivo; cores ociosos indicam partições de menos.

E consideraria alocação dinâmica, que ajusta o número de executores conforme a demanda dos estágios — útil quando o job tem estágios de necessidades muito diferentes, e útil para custo, embora adicione latência de escala.

---

**🔴 P14. Qual a diferença entre RDD, DataFrame e Dataset, e o que você usaria hoje?**

*Resposta modelo:* RDD é a abstração original: uma coleção distribuída de objetos, com API funcional e sem schema. Dá controle total, mas é opaco ao otimizador — o Spark não enxerga dentro de uma lambda arbitrária, então não há predicate pushdown, nem column pruning, nem geração de código.

DataFrame é uma coleção distribuída com schema, conceitualmente uma tabela. As operações são expressas como expressões que o Catalyst entende e otimiza, e a execução usa o formato binário do Tungsten em vez de objetos JVM. É por isso que a mesma lógica em DataFrame roda muito mais rápido que em RDD.

Dataset é o DataFrame tipado, disponível em Scala e Java: tem schema e passa pelo Catalyst, mas oferece verificação de tipos em tempo de compilação. Em Python não existe distinção prática, porque a linguagem não é tipada estaticamente — `DataFrame` é `Dataset[Row]`.

Hoje eu usaria DataFrame/SQL por padrão. Iria para RDD só em casos que a API estruturada não expressa — controle fino de particionamento, algoritmos customizados sobre dados não tabulares — e aceitando conscientemente que perco a otimização.

O ponto conceitual por trás disso é que a API estruturada é **declarativa**: você diz o que quer e o engine decide como. RDD é imperativo: você diz como, e o engine só executa. A camada declarativa é o que permite melhorar o desempenho sem mudar seu código — e é literalmente o que aconteceu com AQE, que acelerou jobs existentes sem que ninguém reescrevesse nada.

---

**🔴 P15. No Structured Streaming, o que acontece se você não definir um watermark numa agregação por janela?**

*Resposta modelo:* O Spark não tem como saber quando uma janela pode ser considerada fechada, então ele mantém o estado de **todas** as janelas abertas indefinidamente, para o caso de chegar um evento atrasado pertencente a qualquer uma delas.

O resultado é que o estado cresce sem limite. O job funciona bem no começo e degrada progressivamente: checkpoints ficam cada vez mais lentos, o uso de memória sobe, a latência aumenta, e eventualmente ele falha por falta de memória. O modo de falha característico é aparecer semanas depois do deploy, quando ninguém associa mais o incidente à mudança — o que torna esse um dos bugs mais frustrantes de streaming.

O watermark resolve declarando quanto atraso você tolera. Quando o watermark ultrapassa o fim de uma janela, o resultado é finalizado e o estado é descartado. O custo é que eventos que chegarem depois disso são ignorados — e por isso o valor do watermark é uma decisão de negócio entre latência, custo de estado e tolerância a perda, não um número técnico.

Vale notar que watermark também interage com o output mode: em modo `append`, a linha de uma janela agregada só é emitida quando o watermark a fecha, então um watermark longo atrasa a saída na mesma medida. E que o mesmo raciocínio vale para joins entre streams e para deduplicação com estado — qualquer operação que mantenha estado por chave precisa de um limite temporal, senão o estado é ilimitado por construção.

---

## 3. Armadilhas comuns

**Chamar `collect()` num dataset grande.** Traz tudo para a memória do driver. É o erro mais rápido de identificar e um dos mais cometidos.

**Cachear indiscriminadamente.** Cache de DataFrame usado uma vez só é puro custo, e consome memória que a execução precisa — podendo tornar o job mais lento, não mais rápido.

**Achar que aumentar recursos resolve skew.** A tarefa gargalo continua igual. Mais executores só encarecem o mesmo tempo de execução.

**Usar `coalesce(1)` antes de gravar após uma transformação pesada.** Reduz o paralelismo de todo o estágio anterior. `repartition(1)` é frequentemente mais rápido no total.

**Não fazer `repartition` pela coluna antes de `partitionBy` na escrita.** Gera o produto cartesiano de tasks por valores de partição em arquivos pequenos.

**Usar UDF Python quando existe função nativa.** Quebra a otimização do Catalyst e adiciona serialização entre JVM e Python.

**Ignorar que PySpark usa memória fora do heap.** Ajustar só `executor.memory` sem ajustar overhead leva a containers mortos pelo gerenciador de recursos, com erro que não parece OOM de JVM.

**Confundir cache com checkpoint.** Cache mantém a linhagem e pode ser perdido; checkpoint persiste em storage confiável e trunca a linhagem. Problemas diferentes.

**Assumir que `shuffle.partitions = 200` é razoável.** É o padrão histórico e quase nunca é o valor certo. Com AQE isso importa menos, mas ainda funciona como teto.

**Não olhar a distribuição de tarefas na UI.** A média esconde skew. O que importa é o máximo comparado à mediana.

**Esquecer watermark em streaming com estado.** Estado ilimitado, falha semanas depois, difícil de diagnosticar.

**Dizer que "Spark é rápido porque processa em memória".** É uma simplificação que entrevistadores usam como filtro. Spark é rápido por várias razões — otimização de plano, geração de código, execução vetorizada, evitar materializar intermediários — e ele **usa disco** o tempo todo, em shuffle e em spill. Dizer só "in-memory" sinaliza conhecimento de marketing, não de arquitetura.
