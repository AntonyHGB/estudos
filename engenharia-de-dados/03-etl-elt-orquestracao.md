# 03 — ETL vs ELT, Orquestração, Idempotência e Reprocessamento

> ETL vs ELT · Idempotência · Backfill · Reprocessamento · CDC · Full load vs incremental · Watermarks de ingestão

Este é o tópico onde entrevistadores separam quem já operou pipeline em produção de quem só construiu. Perguntas sobre idempotência e backfill são o teste mais confiável que existe para isso, porque são problemas que só aparecem quando algo quebra às 3h da manhã.

---

## 1. Resumo conceitual

### 1.1 ETL vs ELT: a mudança de ordem e o porquê

**ETL (Extract, Transform, Load)**: extrai da origem, transforma num servidor intermediário, carrega o resultado já pronto no destino.

**ELT (Extract, Load, Transform)**: extrai da origem, carrega o dado bruto no destino, e transforma **dentro** do destino usando o poder computacional dele.

A diferença não é só a ordem das letras. É uma consequência direta da economia de nuvem:

No mundo ETL clássico, o warehouse era caro e de capacidade fixa. Fazia sentido comprar um servidor de ETL separado (Informatica, DataStage, SSIS), transformar lá, e só carregar o resultado final — porque cada ciclo de CPU no warehouse era escasso e caro.

Com warehouses e lakehouses em nuvem, o compute é elástico e desacoplado do storage. Ficou mais barato e mais simples carregar tudo bruto e transformar lá dentro com SQL, escalando sob demanda. Isso é o que viabilizou ferramentas como dbt e o padrão moderno.

**Vantagens do ELT:**
- **O dado bruto fica disponível.** Se a regra de transformação estava errada, ou se aparece uma pergunta nova, você reprocessa a partir do bruto que já está no destino — sem reler da origem, que pode não ter mais o histórico ou pode não suportar a carga.
- **Transformações em SQL**, acessível a mais gente que um framework proprietário, versionável em Git, testável.
- **Escala elástica**: você usa o mesmo motor que já paga para consultas.
- Separação clara entre ingestão (movimentação, responsabilidade do engenheiro de dados) e transformação (lógica de negócio, frequentemente do analytics engineer).

**Quando ETL ainda faz sentido:**
- **Dados sensíveis** que não podem ser carregados brutos no destino por questão regulatória. Mascaramento, tokenização e anonimização precisam acontecer **antes** — em ELT, o PII entra no warehouse e você depende de controle de acesso, o que pode não satisfazer o regulador.
- **Redução de volume**: se a origem gera 10 TB/dia e o negócio só precisa de agregados, filtrar antes economiza muito storage e ingestão.
- **Transformações que SQL não expressa bem**: parsing complexo, chamadas a APIs de enriquecimento, aplicação de modelo de ML, processamento de imagem/texto.
- **Destino sem capacidade de transformação** (um sistema legado, um banco pequeno).
- **Streaming**, onde a transformação acontece em trânsito por natureza.

Na prática, arquiteturas reais são **híbridas**: um pouco de transformação leve na ingestão (tipagem, mascaramento de PII, deduplicação básica) e o grosso da lógica de negócio no destino. Responder "ELT é o moderno, ETL é legado" é raso e é contra-argumentável em dois segundos com o caso de PII.

Uma variação que vale conhecer: **EtLT** (com t minúsculo), que descreve exatamente esse híbrido — uma transformação mínima e obrigatória antes do load, e a transformação de negócio depois.

**Reverse ETL** é o movimento oposto: levar dados do warehouse **de volta** para sistemas operacionais (CRM, ferramenta de marketing, sistema de suporte). Existe porque as métricas mais valiosas (LTV, propensão de churn, segmento) são calculadas no warehouse mas precisam ser acionáveis onde as pessoas trabalham. Vale mencionar, mostra que você conhece o ciclo completo.

### 1.2 Idempotência — o conceito mais importante do arquivo

**Definição:** uma operação é idempotente quando executá-la N vezes produz o mesmo resultado que executá-la uma vez.

**Por que é o conceito central de engenharia de dados:** porque falhas são certas. Um job vai falhar no meio, uma máquina vai morrer, alguém vai clicar em "retry", o orquestrador vai reexecutar uma tarefa por timeout de rede quando ela na verdade tinha concluído. Se o seu pipeline não é idempotente, cada uma dessas situações corrompe o dado — e o pior é que corrompe **silenciosamente**, porque os números continuam saindo, só que duplicados.

Sem idempotência, a única resposta a uma falha é intervenção manual: alguém precisa investigar o que foi escrito, apagar seletivamente, e reprocessar. Com idempotência, a resposta é "roda de novo", e isso é o que permite automatizar retries, backfills e recuperação de desastre.

**O que quebra idempotência:**

- `INSERT` puro sem chave de deduplicação: rodar duas vezes duplica tudo.
- `UPDATE saldo = saldo + valor`: acumulativo, portanto não idempotente por definição.
- Uso de `now()` ou `current_date` dentro da lógica: o resultado depende de *quando* você rodou, então reexecutar amanhã produz resultado diferente.
- Sequences e auto-increment que geram IDs novos a cada execução.
- Consumo de fila com efeito colateral externo (enviar e-mail, chamar API que cobra).
- Escrita em append num arquivo sem particionamento determinístico.

**Como construir idempotência — em ordem de robustez:**

**1. Escrita particionada com overwrite determinístico.** O padrão mais usado e o mais simples de explicar. Cada execução processa uma janela de tempo bem definida e **sobrescreve exatamente a partição correspondente**. Rodar de novo reescreve a mesma partição com o mesmo conteúdo. É por isso que a maioria dos pipelines de batch particiona por data: a partição é a unidade de idempotência. Em SQL/Spark, isso é `INSERT OVERWRITE` na partição, ou `replaceWhere` / overwrite dinâmico de partição.

**2. MERGE / UPSERT com chave de negócio.** Em vez de inserir, você faz merge por uma chave natural: se a linha existe, atualiza; se não, insere. Rodar duas vezes atualiza para o mesmo valor. Exige que o destino suporte merge (warehouses modernos e formatos de tabela suportam).

**3. Deduplicação por chave de idempotência (idempotency key).** Cada registro carrega um identificador único e estável (um `event_id` gerado na origem, ou um hash determinístico do conteúdo + timestamp). A escrita ignora registros cujo ID já existe. Isso protege inclusive contra duplicação na origem.

**4. Transação atômica ou padrão write-audit-publish.** Você escreve num local temporário, valida, e só então "publica" atomicamente (troca de ponteiro, rename de diretório, commit de transação). Se falhar antes do publish, nada ficou visível. Formatos de tabela transacionais dão isso de graça.

**Ponto crucial que quase ninguém menciona espontaneamente:** idempotência exige que o job seja **determinístico em relação a uma janela de tempo passada como parâmetro**, não em relação ao relógio. O job deve receber a data lógica de execução como argumento e usá-la em toda a lógica. Se você usa `current_date` dentro do job, ele não é reexecutável no passado, e portanto backfill é impossível. Isso é o que Airflow chama de data interval (antigamente `execution_date`), e a confusão em torno disso é fonte inesgotável de bugs.

### 1.3 Backfill e reprocessamento

**Backfill** é preencher dados de períodos passados: ou porque o pipeline é novo e precisa de histórico, ou porque houve uma janela de falha, ou porque a lógica mudou e o histórico precisa refletir a nova regra.

**Reprocessamento** é reexecutar um período já processado, tipicamente porque havia bug ou porque a origem corrigiu dados retroativamente.

Tecnicamente, os dois são a mesma operação, e ambos dependem inteiramente de idempotência. Se o pipeline é idempotente e parametrizado por janela, backfill é "rode as datas de X a Y". Se não é, backfill é um projeto.

**O que considerar num backfill de verdade:**

- **Custo e concorrência.** Reprocessar 2 anos de dados diários são 730 execuções. Rodar todas em paralelo pode derrubar a origem, estourar cota de compute ou custar uma fortuna. Rodar em série pode levar semanas. Airflow, por exemplo, tem `max_active_runs` justamente para isso. A resposta boa menciona controle explícito de paralelismo.
- **Ordem e dependências.** Se o pipeline tem estado que depende do período anterior (saldo acumulado, SCD Tipo 2), você **não pode** rodar as datas em paralelo — precisa de ordem cronológica. Se cada dia é independente, pode paralelizar. Identificar em qual caso você está é parte da resposta.
- **Impacto na origem.** Um backfill que lê o banco de produção 730 vezes pode degradar o sistema operacional. Ler de uma réplica, de um snapshot, ou da camada bruta já ingerida é o caminho.
- **Downstream.** Reprocessar uma tabela invalida tudo que depende dela. Você precisa saber o lineage e decidir se propaga o reprocessamento em cascata, e como avisa os consumidores.
- **Visibilidade durante o processo.** Se você sobrescreve partições enquanto usuários consultam, eles veem estados intermediários inconsistentes. Padrões de mitigação: escrever numa tabela sombra e trocar atomicamente no final; usar transações do formato de tabela; ou fazer o backfill em janela de baixo uso.
- **Backfill de código novo vs dado novo.** Se você mudou a lógica, precisa decidir se o histórico é reescrito com a nova regra (relatórios antigos vão mudar — pode ser inaceitável para dado financeiro já reportado) ou se a nova regra vale só dali para frente. Essa é uma pergunta de negócio, e levantá-la é sinal de senioridade.

**Padrão de reprocessamento seguro (write-audit-publish):** escreva o resultado numa localização temporária; rode as validações de qualidade contra ela; se passar, publique atomicamente; se falhar, aborte sem ter afetado nada visível. Esse padrão resolve simultaneamente atomicidade e qualidade, e é um ótimo nome para citar.

### 1.4 Full load vs incremental

**Full load (snapshot completo)**: lê tudo da origem e sobrescreve o destino a cada execução.
- *A favor:* simples, naturalmente idempotente, imune a mudanças perdidas, autocorretivo (um erro se conserta sozinho na próxima carga).
- *Contra:* custo proporcional ao tamanho total, não ao volume de mudança; inviável acima de certo tamanho; não captura estados intermediários (se um registro mudou duas vezes entre cargas, você só vê o último); e não detecta deleções a menos que você compare.

**Carga incremental**: lê só o que mudou desde a última execução, usando uma coluna de controle (`updated_at`, ID crescente, versão).
- *A favor:* custo proporcional à mudança; permite janelas de execução mais frequentes.
- *Contra:* depende de a origem ter uma coluna confiável de atualização, o que frequentemente não é verdade; **não captura hard deletes** (a linha some da origem e você nunca fica sabendo); e é vulnerável a registros que chegam fora de ordem ou com timestamp de transação anterior ao commit.

**A armadilha clássica do incremental por `updated_at`** — vale conhecer em detalhe porque cai como pergunta avançada: se você filtra `WHERE updated_at > ultimo_watermark`, pode perder registros. Uma transação que **começou** antes do seu corte mas **commitou** depois terá `updated_at` menor que o watermark mas só ficará visível depois — então na próxima execução ela já está "no passado" e é ignorada para sempre. Mitigações: usar uma janela com sobreposição (lookback de alguns minutos ou horas, aceitando reprocessar um pouco, o que só funciona se a escrita for idempotente); usar o log de transações via CDC em vez da coluna; ou usar um mecanismo de versão monotônica garantida pelo banco.

Outra armadilha: `updated_at` preenchido pela aplicação e não pelo banco pode ter clock skew entre servidores, ou simplesmente não ser atualizado por certos caminhos de código (updates em massa, correções manuais em SQL). Perguntar "quem preenche essa coluna e ela é confiável em todos os caminhos de escrita?" é uma das perguntas mais úteis que existem em ingestão.

**Estratégia híbrida muito usada:** incremental diário + full load semanal ou mensal para reconciliar. Você paga o custo do full ocasionalmente e ganha autocorreção contra deleções perdidas e drift acumulado. Mencionar isso é sinal de experiência prática.

### 1.5 CDC — Change Data Capture

CDC captura mudanças no banco de origem lendo o **log de transações** (WAL no Postgres, binlog no MySQL, redo log no Oracle) em vez de consultar as tabelas.

**Por que é superior a polling por `updated_at`:**
- Captura **todas** as mudanças, incluindo deletes e updates em massa.
- Captura a **sequência** de mudanças, não só o estado final — importante quando você precisa de histórico completo.
- Impacto mínimo na origem: lê o log, não executa queries pesadas sobre as tabelas.
- Latência baixa, viabilizando quase tempo real.

**Custos e complicações:**
- Requer acesso privilegiado ao banco e configuração (nível de log, slot de replicação). Times de infraestrutura frequentemente resistem.
- **Slot de replicação abandonado é um risco operacional sério**: se o consumidor CDC para e o slot permanece, o banco de origem retém WAL indefinidamente e pode encher o disco, derrubando a produção. É o tipo de detalhe que só quem operou conhece, e citá-lo tem peso.
- Snapshot inicial: você precisa de uma carga inicial consistente com o ponto do log de onde vai continuar. Ferramentas como Debezium fazem isso, mas é a parte mais delicada.
- Mudança de schema na origem (DDL) precisa ser propagada, e nem sempre é graciosa.
- O consumidor precisa lidar com **ordem** e com a semântica de "estado atual" versus "sequência de eventos".

**Padrões de CDC:**
- **Log-based** (Debezium, ferramentas nativas de cloud): o padrão de ouro.
- **Trigger-based**: triggers no banco gravam mudanças numa tabela de auditoria. Funciona sem acesso ao log, mas adiciona latência e carga a cada escrita da produção.
- **Query-based / polling**: o `updated_at` já discutido. Mais simples, menos confiável.
- **Outbox pattern**: a aplicação escreve, na mesma transação, na tabela de negócio e numa tabela de "outbox" de eventos. Um processo lê a outbox e publica. Garante que o evento e a mudança de estado sejam atômicos — resolve o problema de "escrevi no banco mas falhei ao publicar no Kafka". É um padrão de arquitetura de aplicação, mas engenheiros de dados precisam conhecer porque frequentemente são eles que pedem para o time de backend implementá-lo.

**Duas semânticas de consumo de CDC**, e confundi-las é erro comum: você pode querer o **estado atual** de cada entidade (aplicar as mudanças e manter uma tabela espelho, tipicamente via MERGE) ou o **histórico de mudanças** (guardar cada evento como uma linha, append-only, que é a base para SCD Tipo 2 e auditoria). Muitos pipelines precisam dos dois — o histórico como fonte, e o espelho materializado a partir dele.

### 1.6 Orquestração: o que é e o que não é

Um orquestrador coordena **quando** e **em que ordem** as tarefas rodam, cuida de dependências, retries, alertas e observabilidade. Ele normalmente não faz o processamento pesado — ele dispara e monitora quem faz.

Conceitos essenciais:

- **DAG (Directed Acyclic Graph)**: as tarefas e suas dependências, sem ciclos. Aciclicidade importa porque um ciclo tornaria impossível determinar a ordem de execução.
- **Task / operator**: a unidade de trabalho.
- **Scheduling**: baseado em tempo (cron) ou em evento (chegada de arquivo, mensagem, atualização de dataset/asset).
- **Retry com backoff**: reexecução automática em falha, com espera crescente para não martelar um serviço já degradado.
- **SLA e alertas**: detectar não só falha, mas atraso — um pipeline que "roda" mas termina 6 horas atrasado quebra o consumidor tanto quanto um que falha.
- **Sensor**: espera uma condição externa (arquivo existe, partição pronta, API responde).
- **Backfill**: reexecutar intervalos passados, discutido acima.
- **Idempotência das tarefas**: pré-requisito de tudo, porque retry é automático.

**Orquestração baseada em tempo vs em dados.** O modelo clássico agenda por horário e assume que os dados estarão lá ("roda às 6h, porque a origem termina às 5h"). Isso é frágil: se a origem atrasa, o pipeline processa dado incompleto e produz resultado errado sem falhar. O modelo orientado a dados dispara quando o dado fica **pronto** — dependência declarada sobre datasets/assets, não sobre horário. Airflow 3 formalizou isso com asset-aware scheduling e watchers de fontes externas; Dagster foi construído em torno dessa ideia desde o início. Saber articular esse contraste é uma resposta forte de nível intermediário/avançado.

**Anti-padrões de orquestração:**
- Fazer processamento pesado dentro do orquestrador em vez de delegá-lo ao engine apropriado. O scheduler não é cluster de processamento.
- Um DAG monolítico gigante com centenas de tarefas: falha em cascata, difícil de testar, difícil de reprocessar em parte.
- Dependências implícitas por horário ("roda às 7h porque o outro roda às 6h") em vez de dependências declaradas.
- Passar volumes grandes de dados entre tarefas pelo mecanismo de metadados do orquestrador (XCom no Airflow) em vez de passar referências a storage.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Qual a diferença entre ETL e ELT?**

*Resposta modelo:* Em ETL a transformação acontece antes do carregamento, num sistema intermediário. Em ELT o dado bruto é carregado no destino e transformado lá dentro. A mudança aconteceu porque o compute em nuvem ficou elástico e barato: não faz mais sentido manter um servidor de transformação separado quando o warehouse escala sob demanda.

A vantagem principal do ELT é ter o dado bruto disponível no destino, o que permite reprocessar com lógica nova sem reler da origem. Mas ETL continua necessário em alguns casos — o mais importante é dado sensível que não pode entrar bruto no destino por questão regulatória, onde o mascaramento tem que acontecer antes.

---

**🟢 P2. O que é idempotência e por que importa em pipelines?**

*Resposta modelo:* Uma operação é idempotente quando rodar N vezes dá o mesmo resultado que rodar uma vez. Importa porque falha é certeza: máquina morre, rede cai, alguém clica em retry, o orquestrador reexecuta por timeout. Sem idempotência, cada uma dessas situações duplica ou corrompe dados — e silenciosamente, porque os números continuam saindo.

Com idempotência, a resposta a qualquer falha é "roda de novo", e isso é o que permite automatizar retry, backfill e recuperação. Na prática eu garanto isso escrevendo por partição com overwrite determinístico, ou usando MERGE por chave de negócio, ou deduplicando por uma chave de idempotência do evento.

*Follow-up quase certo:* "Dê um exemplo de operação não-idempotente num pipeline." → `INSERT` sem chave de dedup; `UPDATE saldo = saldo + x`; qualquer lógica que use `current_date` internamente, porque o resultado passa a depender de quando você rodou.

---

**🟢 P3. O que é um DAG e por que precisa ser acíclico?**

*Resposta modelo:* É um grafo direcionado sem ciclos que representa tarefas e suas dependências. Precisa ser acíclico porque um ciclo tornaria impossível determinar uma ordem válida de execução — a tarefa A esperaria B, que esperaria A. A aciclicidade é o que permite fazer ordenação topológica e decidir o que pode rodar em paralelo.

---

**🟢 P4. O que é backfill?**

*Resposta modelo:* É preencher dados de períodos passados — porque o pipeline é novo e precisa de histórico, porque houve uma janela de falha, ou porque a lógica mudou. Tecnicamente é reexecutar o pipeline para intervalos anteriores, e só funciona se o pipeline for idempotente e parametrizado pela janela de tempo em vez de usar o relógio. Se o job usa `current_date` internamente, backfill é impossível sem alterar o código.

---

### 🟡 Intermediário

**🟡 P5. Como você garante idempotência num pipeline de batch diário?**

*Resposta modelo:* Três decisões combinadas.

Primeiro, o job recebe a **data lógica de processamento como parâmetro** e usa esse parâmetro em toda a lógica. Nunca `current_date` internamente — senão o job não é reexecutável no passado.

Segundo, a **partição é a unidade de idempotência**: o job processa a janela daquela data e sobrescreve exatamente a partição correspondente, com `INSERT OVERWRITE` ou equivalente. Rodar duas vezes reescreve a mesma partição com o mesmo conteúdo.

Terceiro, se o destino não permite overwrite de partição — por exemplo, uma tabela dimensão com SCD — uso **MERGE por chave de negócio**, que é naturalmente idempotente porque atualiza para o mesmo valor.

Para robustez extra, especialmente com fontes que podem duplicar, adiciono uma **chave de idempotência** por registro e deduplico na escrita.

*Follow-up:* "E se a escrita for para um sistema externo que não suporta nada disso, como uma API?" → Aí eu manteria uma tabela de controle registrando o que já foi enviado, com a chave de idempotência, e consultaria antes de enviar. Se a API suportar idempotency key no header (muitas suportam), uso a nativa. Se nada disso existir, o mínimo é tornar o efeito colateral o último passo e desenhar para at-least-once, deixando explícito para o consumidor que duplicatas podem ocorrer.

---

**🟡 P6. Você descobriu que uma transformação estava com bug e precisa reprocessar 6 meses de dados. Como conduz?**

*Resposta modelo:* Antes de rodar qualquer coisa, quatro perguntas.

**O histórico deve ser reescrito?** Se são dados financeiros já reportados, mudar o passado pode ser inaceitável — pode ser que a correção só valha dali para frente, com uma nota explicando a quebra de série. Essa é uma decisão de negócio, não minha.

**Quem consome isso?** Preciso do lineage para saber o que fica inválido a jusante e avisar os donos. Reprocessar uma tabela sem propagar deixa inconsistência entre camadas, que é pior que o bug original.

**Qual o impacto na origem e no custo?** Se o pipeline relê a origem, 180 execuções podem degradar o sistema operacional. Prefiro reprocessar a partir da camada bruta já ingerida. E limito o paralelismo explicitamente — rodar 180 execuções simultâneas normalmente é pior que rodar 10 por vez.

**Os dias são independentes?** Se houver estado acumulado ou SCD Tipo 2, tenho que rodar em ordem cronológica, não em paralelo.

Na execução, uso write-audit-publish: escrevo numa localização sombra, rodo validações comparando com o resultado antigo (contagens, somas de métricas-chave, distribuições), e só publico atomicamente se passar. Assim os usuários nunca veem estado intermediário, e se algo estiver errado eu descubro antes de publicar.

Depois, valido uma amostra manualmente com alguém do negócio, e documento a mudança — inclusive porque alguém vai perguntar daqui a três meses por que os números de março mudaram.

---

**🟡 P7. Carga full ou incremental? Como você decide?**

*Resposta modelo:* Decido pelo tamanho da tabela, pela confiabilidade da coluna de controle e pela necessidade de detectar deleções.

Full load é simples, idempotente por natureza e autocorretivo — se um dia der errado, o próximo conserta. Uso enquanto o custo for aceitável, porque a simplicidade vale muito. O limite é quando o volume torna a janela de execução ou o custo inviáveis.

Incremental economiza, mas depende de a origem ter uma coluna de atualização confiável, e a primeira pergunta que faço é: quem preenche essa coluna e ela é atualizada em **todos** os caminhos de escrita? Correções manuais em SQL e updates em massa frequentemente não a atualizam. Além disso, incremental não captura hard deletes.

Na prática, o padrão que uso muito é híbrido: incremental diário para latência e custo, mais um full load semanal ou mensal para reconciliar e capturar deleções e drift.

*Follow-up avançado esperado:* "Existe algum risco no incremental por `updated_at` mesmo se a coluna for confiável?" → Sim, e é sutil: uma transação que começa antes do seu corte e commita depois terá `updated_at` menor que o watermark mas só ficará visível depois — então na execução seguinte ela já está no passado e é ignorada para sempre. Mitigo com uma janela de lookback com sobreposição, aceitando reprocessar um pouco (o que só é seguro porque a escrita é idempotente), ou migrando para CDC baseado em log.

---

**🟡 P8. O que é CDC e quando você o usaria em vez de polling?**

*Resposta modelo:* CDC lê o log de transações do banco (WAL, binlog, redo log) em vez de consultar as tabelas. Usaria quando eu precisasse de latência baixa, quando precisasse capturar deletes e updates em massa que polling perde, quando a origem não tem coluna de atualização confiável, ou quando queries de extração estivessem impactando a produção — CDC lê o log, não sobrecarrega as tabelas.

Os custos são reais: exige acesso privilegiado e configuração do banco, o snapshot inicial precisa ser consistente com o ponto do log onde a captura continua, e mudanças de DDL na origem precisam ser tratadas. E há um risco operacional que vale mencionar: um slot de replicação abandonado faz o banco de origem reter WAL indefinidamente e pode encher o disco da produção. Isso precisa de monitoramento explícito.

*Follow-up:* "Qual a diferença entre consumir CDC como estado atual e como histórico?" → São semânticas diferentes e ambas são válidas. Materializar o estado atual significa aplicar as mudanças via MERGE numa tabela espelho — bom para quem quer "como está agora". Guardar o histórico significa append-only de cada evento de mudança — é o que permite auditoria e é a base natural para construir SCD Tipo 2. Muitos pipelines mantêm os dois: o histórico como fonte de verdade e o espelho derivado dele.

---

**🟡 P9. O que é o outbox pattern e que problema resolve?**

*Resposta modelo:* Resolve o problema do dual write: quando a aplicação precisa gravar no banco e publicar um evento numa fila, não há transação que cubra os dois sistemas. Se o banco commita e a publicação falha, o evento se perde; se publica e o banco faz rollback, você anunciou algo que não aconteceu.

O outbox resolve escrevendo, **na mesma transação do banco**, tanto na tabela de negócio quanto numa tabela de eventos ("outbox"). A transação garante atomicidade local. Depois, um processo separado — tipicamente via CDC sobre a tabela outbox — lê e publica os eventos. Se a publicação falhar, ela é retentada, porque o evento está durável no banco.

É um padrão do lado da aplicação, mas engenheiro de dados precisa conhecer porque frequentemente é quem identifica o problema e pede ao time de backend para implementá-lo. E porque explica por que eventos "perdidos" aparecem em integrações ingênuas.

---

**🟡 P10. Como você desenharia um pipeline para que ele seja fácil de reprocessar?**

*Resposta modelo:* Cinco princípios.

**Parametrizar pela janela de tempo**, nunca usar o relógio dentro da lógica. Isso é o que torna reexecução no passado possível.

**Particionar a saída pela mesma janela**, para que a unidade de reprocessamento e a unidade de escrita coincidam. Assim reprocessar um dia afeta exatamente uma partição.

**Preservar o dado bruto numa camada imutável.** Se você só tem o resultado final, um bug de lógica exige reler da origem — que pode ter mudado, ter perdido histórico ou não suportar a carga.

**Manter as tarefas pequenas e independentes**, para reprocessar uma parte sem reprocessar tudo, e para que uma falha não invalide horas de trabalho.

**Tornar as transformações determinísticas**: nada de valores aleatórios, ordenação instável, ou dependência de estado externo mutável. Se o mesmo input não produz o mesmo output, você não consegue nem validar se o reprocessamento funcionou.

E como prática operacional, versionar o código junto com o dado produzido — saber qual versão da lógica gerou qual partição é o que torna possível decidir o que precisa ser reprocessado.

---

### 🔴 Avançado

**🔴 P11. Seu pipeline diário depende de uma origem que às vezes atrasa. Se ele roda no horário, processa dado incompleto. Como resolve?**

*Resposta modelo:* O problema raiz é que a dependência está expressa em **tempo** quando deveria estar expressa em **dados**. "Roda às 6h porque a origem termina às 5h" é uma suposição não verificada, e quando ela quebra o pipeline não falha — ele produz resultado errado silenciosamente, que é o pior modo de falha possível.

A solução em camadas:

**Curto prazo:** um sensor ou check de prontidão que verifica a condição real (o arquivo existe, a partição está completa, a contagem bate com um marcador de controle) antes de processar, com timeout e alerta. O pipeline espera em vez de processar lixo.

**Melhor:** a origem publica um sinal explícito de conclusão — um marcador de sucesso, uma linha numa tabela de controle, um evento. O consumidor reage ao sinal. Isso transforma a dependência temporal em dependência de dados de verdade.

**Estrutural:** usar orquestração orientada a dados, onde o downstream declara dependência sobre o dataset e é disparado quando ele é atualizado. Airflow 3 formalizou isso com asset-aware scheduling e watchers de fontes externas; Dagster foi desenhado assim desde o início.

Complementarmente: um **SLA de completude** monitorado (alertar se a origem não chegou até X), e um **teste de qualidade que detecta incompletude** (volume muito abaixo do esperado para o dia da semana) que **falha o pipeline** em vez de deixar passar. Processar dado incompleto e publicá-lo é pior do que atrasar — e essa priorização deve ser explícita e acordada com o negócio, não uma decisão técnica solitária.

---

**🔴 P12. Você precisa fazer backfill de 2 anos de dados diários. O pipeline lê de uma API com rate limit e escreve numa tabela que usuários consultam. Descreva sua abordagem.**

*Resposta modelo:* Três restrições distintas, e cada uma exige uma decisão.

**Rate limit da API.** Não posso paralelizar livremente. Preciso de controle explícito de concorrência e de backoff exponencial com jitter em caso de 429. Estimaria o tempo total primeiro: se a 730 execuções com o limite dado o backfill leva três semanas, isso muda o plano — talvez negocie um limite temporário maior, talvez a API tenha endpoint de exportação em lote, talvez exista um dump histórico. Perguntar isso antes de começar economiza semanas.

**Concorrência com o uso normal.** O backfill não pode competir com a execução diária corrente nem consumir toda a cota. Eu daria prioridade à execução do dia (o negócio precisa do dado fresco) e rodaria o backfill em capacidade residual, provavelmente em janela de baixo uso.

**Visibilidade para os usuários.** Escrever partição por partição enquanto usuários consultam expõe estados parciais. Escreveria numa tabela sombra e faria a troca atômica ao final, ou publicaria partição por partição só se cada partição for autocontida e os usuários filtrarem por data — o que ainda assim significa que agregações do período inteiro ficam erradas durante o processo. Se o formato de tabela suportar transações, agrupo os commits.

**Além disso:** checkpoint de progresso persistido, para que uma falha na data 400 não obrigue a recomeçar do zero; idempotência por partição, para poder repetir qualquer intervalo; e validação incremental — comparar volumes e métricas-chave por período contra o esperado enquanto avança, em vez de descobrir no final que os primeiros seis meses vieram vazios porque a API paginava diferente para datas antigas.

Por fim, definiria explicitamente um critério de sucesso e um plano de rollback antes de começar.

---

**🔴 P13. Como você lida com um pipeline que precisa ser idempotente mas escreve num sistema externo com efeito colateral, como enviar notificações?**

*Resposta modelo:* Efeito colateral externo é o caso em que idempotência verdadeira normalmente não existe do lado do pipeline, então a estratégia é empurrar a responsabilidade para onde ela pode ser resolvida.

**Primeiro, separar as fases.** Computo o que deve ser enviado e persisto isso numa tabela de "intenções", com uma chave de idempotência determinística por notificação. Essa fase é totalmente idempotente e reprocessável.

**Segundo, um processo de entrega separado** lê as intenções não entregues, envia, e marca como entregue. Se ele falhar após enviar e antes de marcar, haverá duplicata — isso é inerente, é a mesma limitação do problema de dual write.

**Terceiro, deduplicação no destino.** Se o serviço externo aceitar uma idempotency key (muitos aceitam), o próprio serviço descarta a repetição, e aí você tem exactly-once efetivo. Se não aceitar, a alternativa é um filtro de deduplicação do meu lado, com janela de retenção, aceitando que ele é probabilístico em falhas extremas.

**E o mais importante: desenhar para at-least-once e tornar a duplicata inofensiva.** Uma notificação repetida é ruim mas tolerável; uma cobrança repetida não é. Se o efeito colateral for financeiro ou irreversível, a chave de idempotência no destino deixa de ser opcional e vira requisito de integração — e isso é uma conversa a ter com o time dono do serviço antes de construir o pipeline, não depois.

---

**🔴 P14. Qual a diferença prática entre orquestração baseada em tempo e baseada em dados? Quando o modelo por tempo é suficiente?**

*Resposta modelo:* No modelo por tempo, cada pipeline tem um horário e assume que suas dependências terminaram. A dependência é implícita e não verificada, então quando a premissa quebra o sistema falha silenciosamente — processa dado incompleto e publica.

No modelo por dados, o pipeline declara dependência sobre datasets e é disparado quando eles são atualizados. As dependências ficam explícitas, o grafo de lineage vem de graça, e atrasos se propagam corretamente em vez de produzir dado errado.

O modelo por tempo continua suficiente quando: a fonte é genuinamente periódica e confiável (um extrato bancário que chega sempre às 3h com SLA contratual); o pipeline é a raiz do grafo e não depende de nada interno; ou o custo de processar dado incompleto é baixo e autocorretivo na execução seguinte.

Na prática, o mais comum é híbrido: um gatilho de tempo como piso (garantindo que o pipeline roda pelo menos uma vez por período, mesmo que nada dispare) combinado com sensores ou dependências de dados que garantem que ele só processa quando há o que processar. E, independentemente do modelo, um SLA monitorado — porque a pergunta que importa para o consumidor não é "rodou?" mas "o dado está lá e está correto no horário que eu preciso?".

---

**🔴 P15. Como você versionaria e testaria transformações de dados?**

*Resposta modelo:* Trato transformação como software, com as adaptações que dados exigem.

**Versionamento:** código em Git, com revisão obrigatória. E — o ponto que dados adicionam — registrar qual versão do código produziu cada partição de saída, porque sem isso você não consegue decidir o que precisa de reprocessamento quando descobre um bug.

**Testes em três níveis.** Testes unitários da lógica pura com dados fabricados pequenos, cobrindo casos de borda (NULL, duplicata, valor fora de domínio) — rápidos, rodam em CI. Testes de contrato/schema, verificando que a entrada tem as colunas e tipos esperados, e falhando na ingestão em vez de deixar o erro se propagar. E testes de qualidade sobre o resultado real: unicidade de chave, integridade referencial contra as dimensões, faixas de valores, volume dentro do esperado para o período, e reconciliação contra a origem em métricas-chave.

**Ambientes:** dev/staging com dado representativo — anonimizado se houver PII, e amostrado de forma a preservar casos raros, porque uma amostra aleatória some justamente com o que quebra.

**Antes de mergear mudança em transformação existente**, rodar em paralelo e fazer **diff do resultado** contra a versão atual. É a técnica mais eficaz que existe para transformação de dados, porque testes unitários passam enquanto a lógica de negócio muda sutilmente em 3% das linhas — e é exatamente isso que quebra a confiança dos usuários.

**Em produção**, testes de qualidade rodando como parte do pipeline, com o padrão write-audit-publish: se a validação falha, o dado não é publicado. Detectar depois que publicou já é tarde: alguém tomou decisão com o número errado.

---

## 3. Armadilhas comuns

**Dizer que "ELT substituiu ETL".** É contra-argumentável em uma frase: dado com PII que não pode entrar bruto no destino. A resposta correta é que a maior parte das arquiteturas é híbrida.

**Usar `current_date` ou `now()` dentro da lógica do job.** É a causa raiz número um de pipelines não reprocessáveis. A data lógica tem que ser parâmetro.

**Confundir idempotência com "não dá erro se rodar de novo".** Um `INSERT` que roda duas vezes sem erro não é idempotente — ele duplicou. Idempotência é sobre o **estado final**, não sobre ausência de exceção.

**Assumir que `updated_at` captura tudo.** Não captura hard deletes, pode não ser atualizado por correções manuais ou updates em massa, e sofre o problema de transações longas que commitam depois do watermark. Perguntar "quem preenche essa coluna e em quais caminhos?" é o reflexo certo.

**Fazer backfill sem pensar em concorrência e em downstream.** Disparar 730 execuções em paralelo derruba a origem e/ou explode o custo. E reprocessar sem propagar deixa camadas inconsistentes entre si, o que é pior que o bug original.

**Reescrever o histórico sem perguntar se pode.** Em contextos financeiros e regulados, números já reportados não podem mudar. Levantar essa questão vale mais que a solução técnica.

**Sobrescrever tabelas em produção enquanto usuários consultam.** Estados intermediários geram números errados e destroem confiança. Write-audit-publish existe para isso.

**Tratar o orquestrador como engine de processamento.** Carregar um DataFrame de milhões de linhas dentro de uma task do Airflow em vez de delegar ao warehouse ou ao Spark. O scheduler não é cluster.

**Dependência implícita por horário.** "Roda às 7h porque o outro roda às 6h" não é dependência, é torcida. Declare a dependência ou use um sensor.

**Não monitorar atraso, só falha.** Um pipeline que termina 6 horas depois do necessário quebra o consumidor tanto quanto um que falha — e não gera alerta nenhum se você só monitora exit code.

**Esquecer o risco operacional do CDC.** Slot de replicação abandonado retendo WAL até encher o disco da produção é um incidente real e comum. Citá-lo espontaneamente separa quem operou de quem leu.

**Testar transformação só com teste unitário.** Lógica de negócio muda resultados sutilmente sem quebrar assert nenhum. Diff do output contra a versão anterior é a técnica que realmente pega isso.
