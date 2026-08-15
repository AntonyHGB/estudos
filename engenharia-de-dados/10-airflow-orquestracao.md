# 10 — Airflow e Orquestração

> DAGs e scheduling · Data interval · Dependências · Sensores · Idempotência de tarefas · XCom · Executores · Airflow 3 · Alternativas

---

## 1. Resumo conceitual

### 1.1 O papel de um orquestrador

Um orquestrador responde três perguntas: **quando** algo roda, **em que ordem**, e **o que acontece quando falha**. Ele coordena; ele não processa. Um Airflow bem usado dispara trabalho em outros sistemas (warehouse, Spark, containers) e monitora o resultado.

O que um orquestrador entrega além do cron:
- **Dependências explícitas** entre tarefas, em vez de acoplamento por horário.
- **Retry com política**, backoff e limite.
- **Observabilidade**: histórico de execuções, logs centralizados, duração, estado.
- **Backfill**: reexecutar intervalos passados de forma controlada.
- **SLA e alertas**, incluindo detecção de atraso, não só de falha.
- **Paralelismo controlado**: limites por DAG, por tarefa, por pool de recursos.

### 1.2 DAG, tarefas e o modelo de execução

Um **DAG** é a definição do fluxo: tarefas e suas dependências, sem ciclos. No Airflow, é código Python que **descreve** o grafo — não que executa o trabalho. Essa distinção é a fonte de vários erros: código no corpo do DAG roda a cada parse do arquivo, que acontece a cada poucos segundos no scheduler, para todos os DAGs. Fazer uma consulta a banco ou chamada de API no nível do módulo é um erro clássico e custoso.

Componentes:
- **Operator**: o modelo de uma tarefa (executar SQL, rodar um container, chamar uma API).
- **Task**: uma instância de operator dentro de um DAG.
- **Task Instance**: a execução de uma task para um intervalo específico.
- **DAG Run**: a execução do DAG para um intervalo específico.
- **Sensor**: uma tarefa que espera uma condição externa. Em modo *reschedule* ele libera o worker entre verificações, em vez de ocupar um slot ocioso — a diferença importa muito em escala, e sensores em modo poke ocupando slots é uma causa clássica de deadlock de pool.
- **Hook**: a abstração de conexão com um sistema externo.
- **Pool**: limite de concorrência para um conjunto de tarefas, usado para não sobrecarregar um recurso compartilhado (um banco de origem, por exemplo).
- **Trigger rule**: a condição sob a qual uma tarefa roda em função do estado das anteriores. O padrão é `all_success`, mas `all_done`, `one_failed` e `none_failed_min_one_success` permitem construir ramos de tratamento de erro e limpeza.

### 1.3 Data interval — o conceito que mais confunde

O Airflow agenda por **intervalo de dados**, não por instante. Um DAG diário com intervalo `2026-08-13 00:00` a `2026-08-14 00:00` **só é disparado no fim do intervalo**, ou seja, à meia-noite de 14.

Isso é intencional e correto: o pipeline processa o dia 13, e o dia 13 só está completo depois que ele termina. O nome antigo dessa ideia, `execution_date`, era péssimo e causou anos de confusão, porque parecia ser "quando rodou" quando na verdade era "o início do período processado". Versões modernas usam `data_interval_start` e `data_interval_end`, que são explícitos.

**Por que isso importa para o seu código:** a tarefa deve usar o intervalo como parâmetro em toda a lógica — filtrar a origem por `data_interval_start` e `data_interval_end`, e escrever na partição correspondente. Se ela usa `now()` ou `current_date`, ela deixa de ser reexecutável no passado, e backfill passa a produzir resultado errado (todas as execuções processariam o dia de hoje). Esta é a conexão direta entre Airflow e o conceito de idempotência do arquivo 03.

**Catchup** controla se, ao ativar um DAG (ou depois de uma pausa), o Airflow executa todos os intervalos passados desde a data de início. Ligado por padrão em versões antigas, é uma armadilha conhecida: ativar um DAG com `start_date` há um ano dispara centenas de execuções de uma vez. Combine com `max_active_runs` para limitar a concorrência, ou desligue o catchup quando o histórico não for necessário.

### 1.4 Scheduling

Formas de agendar:
- **Cron ou intervalo fixo** (`@daily`, expressão cron, timedelta).
- **Timetable customizada**, para regras que cron não expressa — dias úteis considerando feriados, calendários fiscais.
- **Disparo por dataset/asset**: o DAG roda quando outro DAG atualiza um dataset do qual ele depende. Isso é orquestração **orientada a dados** em vez de a tempo, e resolve o problema clássico de "roda às 7h porque o outro roda às 6h", que é uma suposição não verificada.
- **Externo**: chamada de API, evento, ação manual.

**Airflow 3** avançou bastante nessa direção: os "datasets" evoluíram para **assets** com um decorador dedicado, o scheduler ficou mais orientado a eventos, e há **watchers** que observam fontes externas para disparar DAGs — com suporte a SQS de saída de fábrica e a base para outros gatilhos. A outra novidade importante da versão 3 é o **versionamento de DAG**: uma execução roda até o fim com a versão vigente quando começou, mesmo que uma nova versão seja publicada no meio, e a interface associa cada execução à versão que a produziu, incluindo estrutura de tarefas, código e logs. Isso resolve um problema real e antigo de auditoria — antes, você via logs de uma execução mas o código exibido já era outro. Backfills também passaram a ser gerenciados pelo scheduler como cidadãos de primeira classe.

### 1.5 Passagem de dados entre tarefas: XCom

**XCom** ("cross-communication") permite que uma tarefa passe um valor para outra. É armazenado no banco de metadados do Airflow.

**A regra:** XCom serve para **metadados pequenos** — um caminho de arquivo, um identificador de job, uma contagem, um flag. Nunca para dados. Passar um DataFrame ou um JSON de megabytes pelo XCom incha o banco de metadados, degrada o scheduler e é um antipadrão bem conhecido.

O padrão correto é passar **referências**: a tarefa A escreve o resultado em storage e passa o caminho pelo XCom; a tarefa B lê do caminho. Versões modernas suportam **custom XCom backends**, que persistem o valor em object storage transparentemente — o que resolve o problema sem mudar o código, mas não muda o princípio de que o orquestrador não deve ser um barramento de dados.

### 1.6 Executores e escalabilidade

- **SequentialExecutor**: uma tarefa por vez. Só para desenvolvimento.
- **LocalExecutor**: processos paralelos numa máquina. Suficiente para cargas pequenas e médias.
- **CeleryExecutor**: workers distribuídos com fila de mensagens. O padrão histórico para escala, com workers de longa duração.
- **KubernetesExecutor**: cada tarefa roda num pod próprio. Isolamento total, dependências por tarefa, escala elástica. O custo é latência de inicialização do pod, o que pesa quando as tarefas são muito curtas.
- **CeleryKubernetesExecutor / híbridos**: rotear tarefas curtas para Celery e pesadas para Kubernetes.

**Gargalos típicos do Airflow**, que rendem boas respostas de troubleshooting:
- **Tempo de parse dos DAGs.** O scheduler reprocessa os arquivos periodicamente. Código pesado no nível do módulo, importações lentas ou centenas de arquivos deixam o scheduler lento e atrasam todo o agendamento.
- **Banco de metadados.** Ele é o coração do Airflow. XComs grandes, histórico não limpo e muitas task instances degradam tudo. Limpeza periódica de registros antigos é manutenção obrigatória.
- **Concorrência mal configurada.** Paralelismo global, por DAG, por tarefa e por pool interagem, e o limite efetivo é o menor deles — o que causa a confusão de "aumentei os workers e não melhorou".
- **Sensores ocupando slots.** Muitos sensores em modo poke consomem todos os slots disponíveis e travam o cluster esperando; modo reschedule ou deferrable operators resolvem.

**Deferrable operators e triggerer** são a solução moderna para espera: a tarefa registra uma condição e libera o worker, e um processo `triggerer` assíncrono monitora milhares de condições com pouquíssimo recurso, retomando a tarefa quando a condição é satisfeita. Para pipelines com muita espera — sensores de arquivo, jobs externos longos — a economia de recursos é enorme. É um ótimo detalhe para citar.

### 1.7 Boas práticas de design de DAG

**Tarefas atômicas e idempotentes.** Cada tarefa faz uma coisa e pode ser reexecutada sem efeito colateral. Isso é o que torna retry automático seguro.

**Parametrizar pelo data interval, nunca pelo relógio.**

**Evitar DAGs monolíticos.** Um DAG com centenas de tarefas é difícil de testar, de reprocessar em parte, e uma falha no meio invalida muito trabalho. Prefira DAGs menores conectados por dependência de dataset.

**Nada de trabalho pesado no corpo do DAG.** O arquivo é parseado constantemente; consultas e chamadas externas no nível do módulo custam caro e podem derrubar o scheduler.

**Não usar o Airflow como engine de processamento.** Carregar milhões de linhas num DataFrame dentro de uma task é usar o orquestrador como cluster. Delegue ao warehouse ou ao Spark e deixe o Airflow coordenar.

**Dependências declaradas, não implícitas por horário.** Se o DAG B precisa do resultado do DAG A, expresse isso — por dataset/asset, ou por um sensor que verifica a condição real —, não colocando B uma hora depois de A.

**Alertar em SLA, não só em falha.** Um pipeline que termina 6 horas atrasado quebra o consumidor tanto quanto um que falha, e não gera alerta se você só monitora estado final.

**Configuração e segredos fora do código.** Connections, Variables e um backend de secrets. Credencial em código versionado é um achado de auditoria garantido.

### 1.8 Alternativas e como posicioná-las

Vale conhecer para responder "por que Airflow e não X":

- **Dagster**: orientado a **assets** desde a concepção — você declara os dados que devem existir e o framework deriva a execução. Tem tipagem, testabilidade e lineage embutidos. É a alternativa conceitualmente mais distinta.
- **Prefect**: foco em experiência de desenvolvimento e fluxos dinâmicos, com menos cerimônia.
- **dbt**: não é orquestrador — é uma ferramenta de transformação que gera um DAG **dentro** do warehouse. Costuma ser orquestrado *pelo* Airflow, não substituí-lo. Confundir os dois é um erro comum.
- **Mage, Kestra, Temporal**: outras opções; Temporal em particular é orquestração de workflows de aplicação, com um modelo durável de execução, e não uma ferramenta de dados.
- **Orquestradores gerenciados de nuvem** (Step Functions, Cloud Composer, MWAA, Data Factory): menos operação, mais lock-in.

A resposta honesta sobre o Airflow: é o padrão de fato, com o maior ecossistema de integrações e a maior base de conhecimento, e a versão 3 fechou boa parte da distância conceitual em relação aos concorrentes com asset-aware scheduling e versionamento. As críticas históricas — modelo centrado em tarefas em vez de dados, testabilidade limitada, complexidade operacional — motivaram os concorrentes e são as que você deve saber articular.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. O que é o Airflow e para que serve?**

*Resposta modelo:* É um orquestrador de workflows: define fluxos como DAGs em Python, agenda execuções, gerencia dependências entre tarefas, faz retry em falha e dá observabilidade sobre o histórico.

O ponto importante é que ele coordena, não processa. Um bom uso dispara trabalho no warehouse, no Spark ou em containers e monitora o resultado — não carrega dados dentro da própria tarefa.

---

**🟢 P2. O que é um operator, uma task e um DAG run?**

*Resposta modelo:* Operator é o modelo de um tipo de tarefa — executar SQL, rodar um container, chamar uma API. Task é uma instância de operator dentro de um DAG. Task instance é a execução dessa task para um intervalo específico. E DAG run é a execução do DAG inteiro para um intervalo.

---

**🟢 P3. O que é um sensor?**

*Resposta modelo:* É uma tarefa que espera uma condição externa — um arquivo existir, uma partição estar pronta, um job externo terminar — antes de liberar as tarefas seguintes.

O cuidado prático é que um sensor em modo poke ocupa um slot de worker o tempo inteiro da espera. Muitos sensores assim consomem todos os slots e travam o cluster esperando. Uso modo reschedule, que libera o worker entre verificações, ou deferrable operators, que registram a condição num processo assíncrono e liberam o worker completamente.

---

**🟢 P4. Como o Airflow lida com falha de uma tarefa?**

*Resposta modelo:* Ele reexecuta conforme a política de retry configurada — número de tentativas e intervalo, tipicamente com backoff. Se esgotar as tentativas, a tarefa fica em estado de falha e as dependentes não rodam, a menos que tenham uma trigger rule diferente do padrão.

Isso só é seguro se a tarefa for idempotente. Retry automático sobre uma tarefa que faz `INSERT` sem deduplicação duplica dados a cada tentativa — e silenciosamente.

---

### 🟡 Intermediário

**🟡 P5. Explique o data interval. Por que um DAG diário roda depois do fim do dia?**

*Resposta modelo:* O Airflow agenda por intervalo de dados, não por instante. Um DAG diário com intervalo do dia 13 é disparado à meia-noite do dia 14, porque o dia 13 só está completo depois que ele termina — e o pipeline processa o dia 13.

Isso importa para o código: a tarefa deve usar `data_interval_start` e `data_interval_end` como parâmetros para filtrar a origem e escolher a partição de escrita. Se ela usa `now()` internamente, deixa de ser reexecutável no passado, e um backfill passa a processar o dia de hoje em todas as execuções — que é o bug mais comum relacionado a esse conceito.

O nome antigo, `execution_date`, causou muita confusão porque parecia significar "quando rodou" quando na verdade era o início do período processado.

---

**🟡 P6. O que é catchup e quando desligar?**

*Resposta modelo:* Catchup faz o Airflow executar todos os intervalos passados entre a `start_date` e agora quando um DAG é ativado ou despausado.

Desligo quando o histórico não faz sentido — um DAG que só precisa processar o presente, ou um cuja origem não tem dado antigo. E é uma armadilha conhecida: ativar um DAG com `start_date` há um ano dispara centenas de execuções simultâneas, que podem derrubar a origem ou estourar o custo.

Quando quero o histórico, mantenho o catchup ligado mas combino com `max_active_runs` para limitar a concorrência, e verifico se as execuções são independentes entre si — se houver estado acumulado, elas precisam rodar em ordem cronológica, não em paralelo.

---

**🟡 P7. O que é XCom e qual a limitação?**

*Resposta modelo:* É o mecanismo de passar valores entre tarefas, armazenado no banco de metadados do Airflow.

A limitação é que ele serve para metadados pequenos — um caminho de arquivo, um ID de job, uma contagem. Passar dados de verdade incha o banco de metadados, que é o coração do Airflow, e degrada o scheduler para todo mundo.

O padrão correto é passar referências: a tarefa A escreve em storage e passa o caminho; a tarefa B lê de lá. Existem custom XCom backends que persistem em object storage transparentemente, o que ajuda, mas não muda o princípio de que o orquestrador não deve ser barramento de dados.

---

**🟡 P8. Quais são os executores e como escolher?**

*Resposta modelo:* Sequential só para desenvolvimento. Local roda processos paralelos numa máquina e é suficiente para carga pequena e média. Celery distribui em workers de longa duração com uma fila de mensagens, e foi o padrão para escala. Kubernetes roda cada tarefa num pod próprio, dando isolamento total e dependências por tarefa, com escala elástica.

Escolho pelo perfil das tarefas. Kubernetes é ótimo quando as tarefas são pesadas, têm requisitos de recursos diferentes ou dependências conflitantes; o custo é a latência de inicialização do pod, que pesa se as tarefas forem muito curtas e frequentes. Celery tem latência menor porque os workers já estão de pé, mas exige que o ambiente seja comum a todas as tarefas.

Se a carga for mista, há configurações híbridas que roteiam tarefas curtas para Celery e pesadas para Kubernetes.

---

**🟡 P9. Como você garantiria que um DAG é idempotente?**

*Resposta modelo:* Três coisas.

Primeiro, parametrizar tudo pelo data interval e nunca usar o relógio dentro da lógica — sem isso, backfill não funciona.

Segundo, escrita determinística: a tarefa sobrescreve a partição correspondente ao intervalo, ou faz MERGE por chave de negócio. Nunca `INSERT` puro, porque o retry automático duplicaria.

Terceiro, tarefas atômicas: cada uma faz uma coisa, de modo que reexecutar uma delas não exija desfazer o que outra fez.

E, para efeitos colaterais externos que não são idempotentes por natureza — enviar notificação, chamar API que cobra — mantenho uma tabela de controle do que já foi feito, ou uso a idempotency key do serviço de destino se ele suportar.

---

### 🔴 Avançado

**🔴 P10. O scheduler do Airflow está lento e as tarefas demoram a ser agendadas. Como investiga?**

*Resposta modelo:* Três frentes.

**Tempo de parse dos DAGs.** O scheduler reprocessa os arquivos de DAG periodicamente. Se algum tem código pesado no nível do módulo — uma consulta a banco, uma chamada de API, uma importação lenta — esse custo é pago repetidamente e atrasa tudo. Verifico as métricas de tempo de parse por arquivo e movo qualquer trabalho para dentro das tarefas. Também conto quantos arquivos de DAG existem: centenas de arquivos, especialmente com geração dinâmica, multiplicam o problema.

**Banco de metadados.** É o coração do Airflow e o gargalo mais comum. Verifico o tamanho das tabelas de task instance, log e XCom. Histórico não limpo e XComs grandes degradam todas as consultas do scheduler. Limpeza periódica de registros antigos é manutenção obrigatória e frequentemente esquecida.

**Concorrência.** Se as tarefas estão em fila e não executam, o limite efetivo é o menor entre paralelismo global, concorrência por DAG, concorrência por tarefa e o pool. Muita gente aumenta workers e não vê melhora porque o gargalo é um limite de configuração, não de capacidade. Verifico também se sensores em modo poke estão ocupando os slots — é a causa clássica de cluster travado com workers "ocupados" sem fazer nada.

E confirmaria se há mais de uma instância de scheduler, que é suportado e ajuda em escala, e se os recursos da máquina do scheduler são suficientes.

---

**🔴 P11. Como você estruturaria a orquestração de 200 pipelines com dependências entre si?**

*Resposta modelo:* Não faria um DAG gigante nem 200 DAGs isolados acoplados por horário.

**Dependências orientadas a dados.** Cada pipeline declara os assets/datasets que produz e os que consome, e o disparo acontece quando as dependências são atualizadas. Isso elimina a fragilidade de "roda às 7h porque o outro roda às 6h" e dá o grafo de lineage de graça. É exatamente para isso que o asset-aware scheduling do Airflow 3 existe, e é o modelo nativo do Dagster.

**Granularidade por domínio.** DAGs por domínio de negócio ou por fonte, de tamanho compreensível — dezenas de tarefas, não centenas. Isso permite reprocessar uma parte sem tocar no resto e mantém o raio de explosão de uma falha pequeno.

**Padronização por fábrica de DAGs.** Com 200 pipelines, escrever cada um à mão gera divergência. Uma camada de geração a partir de configuração declarativa (YAML, ou uma função factory) garante que todos tenham retry, alerta, SLA, ownership e convenções de nomenclatura consistentes. O cuidado é que geração dinâmica de DAG pesa no parse, então a configuração precisa ser barata de ler.

**Isolamento de recursos.** Pools por sistema de origem, para que um backfill não derrube o banco que outros dez pipelines usam. Prioridades para o que é crítico.

**Ownership e SLA por pipeline.** Com 200 pipelines, "o time de dados" não é dono útil — cada um precisa de um responsável nomeado e de um SLA declarado, senão nada é priorizado quando várias coisas quebram ao mesmo tempo.

**Observabilidade agregada.** Um painel que responde "o que está atrasado e quem depende disso", não 200 DAGs para olhar um a um. Alerta por SLA violado, não só por falha.

---

**🔴 P12. Um DAG precisa processar arquivos que chegam em horários imprevisíveis. Como você desenharia?**

*Resposta modelo:* Evitaria a solução ingênua de um sensor em modo poke esperando indefinidamente, que ocupa um slot de worker por toda a espera e não escala.

A melhor opção é **disparo por evento**: a chegada do arquivo gera uma notificação — evento de object storage, mensagem numa fila — que dispara o DAG. Assim não há espera nenhuma, e a latência é mínima. O Airflow 3 traz watchers para fontes externas, e é possível disparar por API a partir de uma função serverless que reage ao evento de storage.

Se o disparo por evento não estiver disponível, uso **deferrable operators**: a tarefa registra a condição e libera o worker; um processo triggerer assíncrono monitora milhares de condições com pouco recurso e retoma a tarefa quando ela é satisfeita. Se nem isso, sensor em modo reschedule, que ao menos libera o worker entre verificações.

Em qualquer caso, três cuidados: **timeout com alerta**, para que "o arquivo nunca chegou" seja um incidente visível e não uma espera silenciosa; **idempotência**, porque eventos de storage podem ser entregues mais de uma vez e o mesmo arquivo pode disparar duas execuções; e **tratamento de chegada parcial**, verificando se o arquivo está completo antes de processar — um arquivo grande pode gerar evento antes do upload terminar, dependendo do mecanismo, e a proteção usual é usar um marcador de conclusão ou verificar tamanho estável.

Se houver muitos arquivos pequenos chegando continuamente, eu consideraria agrupar em micro-batches por janela em vez de uma execução por arquivo, para não gerar milhares de DAG runs e small files.

---

**🔴 P13. Airflow ou Dagster? Como você decidiria?**

*Resposta modelo:* A diferença conceitual é o que orquestrar significa em cada um. O Airflow foi construído em torno de **tarefas**: você declara o que executar e em que ordem. O Dagster foi construído em torno de **assets**: você declara os dados que devem existir e como são produzidos, e o framework deriva a execução, o lineage e a materialização.

O modelo de assets tende a ser melhor para plataformas de dados, porque a pergunta operacional real quase nunca é "essa tarefa rodou?" e sim "essa tabela está atualizada e correta?". Dagster também nasceu com melhor testabilidade, tipagem entre etapas e ambientes de desenvolvimento.

A favor do Airflow: é o padrão de fato, com o maior ecossistema de integrações, a maior base de conhecimento e o maior mercado de profissionais — o que importa para contratar e para resolver problemas. E o Airflow 3 fechou boa parte da distância conceitual com asset-aware scheduling, versionamento de DAG e backfills gerenciados pelo scheduler.

Na prática eu decidiria pelo contexto: se a empresa já tem Airflow rodando bem, migrar 200 pipelines raramente se paga — o custo de migração e de reaprendizado é alto e o ganho é incremental. Para uma plataforma nova, com time pequeno e ênfase em qualidade e lineage, Dagster é uma escolha defensável. O erro seria tratar isso como questão de preferência técnica: é uma decisão de custo de migração, de contratação e de maturidade do time.

E acrescentaria que dbt não entra nessa comparação — ele transforma dentro do warehouse e é orquestrado por um dos dois, não uma alternativa a eles.

---

**🔴 P14. Como você testaria DAGs e pipelines de dados antes de ir para produção?**

*Resposta modelo:* Em camadas, porque cada uma pega um tipo diferente de problema.

**Testes estruturais do DAG**, rodando em CI a cada commit: o arquivo é parseável, não há ciclos, todas as tarefas têm dono e retry configurados, os IDs seguem a convenção, não há importação pesada no nível do módulo. São baratos e pegam a maior parte dos erros bobos.

**Testes unitários da lógica de transformação**, com dados fabricados pequenos cobrindo casos de borda — NULL, duplicata, valor fora de domínio. Isso exige que a lógica esteja em funções separadas do operator, o que é uma boa prática por si só.

**Testes de integração em ambiente de staging**, com dado representativo — anonimizado se houver PII, e amostrado de forma a preservar casos raros, porque amostra aleatória perde justamente o que quebra.

**Diff de resultado.** Para mudanças em transformação existente, rodar a versão nova em paralelo e comparar o output com o atual. É a técnica mais eficaz que existe em dados, porque testes unitários passam enquanto a lógica de negócio muda sutilmente em 3% das linhas — e é isso que destrói a confiança dos usuários.

**Testes de qualidade em produção**, rodando como parte do pipeline com padrão write-audit-publish: escreve em local temporário, valida, publica só se passar. Detectar depois de publicar já é tarde, porque alguém decidiu com o número errado.

E, para mudanças arriscadas, deploy gradual: rodar o novo escrevendo num destino sombra por alguns dias antes de cortar.

---

**🔴 P15. Qual a diferença entre orquestração e o que o dbt faz? Eles competem?**

*Resposta modelo:* Não competem, operam em camadas diferentes.

O dbt é uma ferramenta de **transformação**: ele compila modelos SQL, resolve dependências entre eles por referências no código, e executa dentro do warehouse. Ele gera um DAG, mas é um DAG de modelos SQL **dentro** de um sistema, não de tarefas heterogêneas entre sistemas. Ele não ingere dados, não chama APIs, não roda containers, não agenda por si só em ambiente auto-hospedado.

O orquestrador coordena o ciclo completo: ingerir da origem, disparar o dbt, rodar validações, atualizar índices ou caches, notificar consumidores, e lidar com falha e retry em qualquer uma dessas etapas.

Na prática, o padrão comum é o Airflow disparando o dbt — frequentemente com granularidade fina, uma tarefa por modelo ou por grupo, para ter visibilidade e retry por modelo em vez de um bloco monolítico que falha inteiro. Existem integrações que expandem o grafo do dbt em tarefas do Airflow automaticamente.

A confusão surge porque ambos falam em DAG. A distinção que eu usaria é: dbt organiza **transformações dentro do warehouse**; o orquestrador organiza **processos entre sistemas**.

---

## 3. Armadilhas comuns

**Confundir data interval com data de execução.** Um DAG diário roda no fim do intervalo. Usar `now()` na lógica em vez do intervalo quebra o backfill de forma silenciosa.

**Usar o Airflow como engine de processamento.** Carregar milhões de linhas dentro de uma task transforma o scheduler em cluster de dados. Delegue.

**Passar dados grandes por XCom.** Incha o banco de metadados e degrada o scheduler para todos os DAGs. Passe referências.

**Código pesado no corpo do DAG.** O arquivo é parseado constantemente. Consulta a banco ou chamada de API no nível do módulo é multiplicada por cada ciclo de parse.

**Ativar um DAG com catchup ligado e `start_date` antiga.** Dispara centenas de execuções simultâneas, podendo derrubar a origem.

**Sensores em modo poke ocupando todos os slots.** Cluster travado com workers "ocupados" esperando. Use reschedule ou deferrable.

**Dependência implícita por horário.** "Roda às 7h porque o outro roda às 6h" não é dependência. Declare por dataset/asset ou use sensor.

**Monitorar apenas falha, não atraso.** Um pipeline que termina 6 horas atrasado quebra o consumidor e não gera alerta nenhum sem SLA.

**Tarefas não idempotentes com retry ligado.** O retry automático duplica dados. É o combo mais destrutivo e mais comum.

**DAG monolítico com centenas de tarefas.** Difícil de testar, de reprocessar em parte, e uma falha no meio invalida muito trabalho.

**Não limpar o banco de metadados.** Histórico acumulado degrada o scheduler progressivamente, e o sintoma aparece meses depois.

**Aumentar workers sem verificar limites de concorrência.** O limite efetivo é o menor entre paralelismo global, por DAG, por tarefa e por pool.

**Achar que dbt substitui o orquestrador.** Ele transforma dentro do warehouse; não ingere, não coordena entre sistemas, não gerencia o ciclo completo.
