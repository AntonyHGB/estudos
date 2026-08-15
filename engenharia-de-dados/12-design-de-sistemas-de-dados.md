# 12 — Design de Sistemas de Dados

> O framework de resposta · Estimativas de capacidade · Cenários completos resolvidos · Erros que reprovam · Como conduzir os 45 minutos

Esta é a rodada que define o **nível da oferta**. Perguntas técnicas pontuais mostram o que você sabe; a rodada de design mostra como você pensa, prioriza e comunica. Um candidato com conhecimento mediano e ótimo método aqui frequentemente passa à frente de um candidato tecnicamente melhor e desorganizado.

---

## 1. Como funciona essa rodada

### 1.1 O que está sendo avaliado

Não é a arquitetura "certa" — não existe uma. O que se avalia:

1. **Você faz as perguntas certas antes de projetar?** A pergunta é deliberadamente vaga. Sair desenhando sem clarificar é o erro número um.
2. **Você raciocina sobre escala com números?** "Muitos dados" não é análise. "500 GB/dia comprimido, 6 TB/mês, 70 TB/ano" é.
3. **Você conhece os trade-offs e os assume explicitamente?** Toda escolha custa algo. Apresentar uma solução sem custo indica que você não conhece o custo.
4. **Você prioriza?** Em 45 minutos não dá para cobrir tudo. Saber o que é essencial e o que é detalhe é sinal de senioridade.
5. **Você pensa em falha e operação?** Júnior desenha o caminho feliz. Sênior desenha o que acontece quando o pipeline cai às 3h da manhã, e quem é acordado.
6. **Você comunica bem?** Estrutura, vocabulário preciso, e capacidade de mudar de nível de abstração conforme o interlocutor.

### 1.2 O framework — 45 minutos

**Fase 1 — Clarificação (5–8 min).** Nunca pule. Perguntas que valem a pena:

*Funcionais:* Quem consome e para tomar qual decisão? Quais perguntas o sistema precisa responder? Quais são os casos de uso principais e quais estão fora de escopo?

*Escala:* Qual o volume atual e a taxa de crescimento? Quantos eventos por segundo no pico? Quantos usuários simultâneos? Qual o tamanho do histórico a reter?

*Latência:* Qual a defasagem aceitável entre o evento e o dado disponível? (Se a resposta for "tempo real", pergunte *qual decisão* é tomada nesse prazo — na maioria das vezes o requisito real é de minutos.)

*Consistência e correção:* O número pode mudar depois de exibido? Duplicata é tolerável? Perder um evento é tolerável?

*Restrições:* Nuvem específica? Ferramentas já em uso? Tamanho e senioridade do time? Orçamento? Regulação — há PII, há exigência de retenção ou de residência de dados?

Feche essa fase declarando as premissas em voz alta: "Vou assumir X, Y e Z. Se algum desses estiver errado, me interrompa." Isso protege você e mostra método.

**Fase 2 — Estimativas (3–5 min).** Números aproximados, em voz alta. Isso guia todas as decisões seguintes e demonstra raciocínio quantitativo. Não precisa ser exato — precisa ter a ordem de grandeza certa.

**Fase 3 — Arquitetura de alto nível (10 min).** Desenhe o fluxo em blocos: fontes → ingestão → armazenamento → processamento → serving → consumo. Fale sobre o fluxo antes de escolher tecnologias. Só então nomeie ferramentas, e sempre justificando pelo requisito, não pela popularidade.

**Fase 4 — Aprofundamento (15 min).** O entrevistador vai escolher uma área. Se ele não escolher, escolha você a mais interessante ou a mais arriscada — e diga por que escolheu. Candidatos que aprofundam sozinhos na parte difícil se destacam.

**Fase 5 — Falhas, operação e evolução (5–8 min).** O que quebra? Como detecta? Como recupera? Como reprocessa? Quanto custa? Como escala quando o volume multiplicar por 10? Reserve tempo para isso — é onde a senioridade aparece e é o que a maioria não alcança por má gestão de tempo.

### 1.3 Estimativas: como fazer rápido

Números de referência úteis para ter na cabeça:

- 1 dia ≈ 86.400 s ≈ 10⁵ s. Então **1.000 eventos/s ≈ 100 milhões de eventos/dia** (arredondando para cima). É a conversão mais útil de todas.
- Pico costuma ser 2 a 5× a média. Dimensione pelo pico, não pela média.
- Evento JSON típico: 0,5–2 KB. Em Parquet comprimido, o mesmo evento cai para algo como 50–200 bytes — uma redução de 5 a 10×.
- 1 TB/dia ≈ 365 TB/ano ≈ 0,37 PB/ano.
- Uma linha de tabela relacional larga: ~1 KB. Uma linha estreita de fato: ~100 bytes.

**Exemplo de raciocínio em voz alta:**

> "10.000 eventos/s no pico, média de 3.000/s. Por dia: 3.000 × 10⁵ ≈ 300 milhões de eventos. A 1 KB por evento em JSON, são 300 GB/dia brutos. Em Parquet comprimido, com fator de 8, ficam ~40 GB/dia, ou ~14 TB/ano. Isso é volume perfeitamente tratável — não preciso de arquitetura exótica. O ponto de atenção não é volume, é a taxa de 10.000/s no pico na ingestão, que define o dimensionamento de partições do Kafka."

Repare no que essa conclusão faz: ela **redireciona o design** para o gargalo real. É exatamente isso que se espera.

### 1.4 Vocabulário de blocos arquiteturais

Ter esse mapa mental acelera muito a resposta:

| Camada | Função | Opções típicas |
|---|---|---|
| Ingestão batch | Trazer dados em lotes | Ferramentas de EL gerenciadas, jobs customizados, Kafka Connect |
| Ingestão CDC | Capturar mudanças do OLTP | Debezium, ferramentas nativas de nuvem |
| Ingestão streaming | Receber eventos contínuos | Kafka, Kinesis, Pub/Sub |
| Storage bruto | Guardar tudo como veio | Object storage + Parquet/Avro |
| Formato de tabela | ACID, time travel, upsert | Iceberg, Delta, Hudi |
| Processamento batch | Transformação pesada | Spark, warehouse SQL, dbt |
| Processamento streaming | Transformação contínua | Flink, Spark Structured Streaming, Kafka Streams |
| Serving analítico | Consulta de BI | Snowflake, BigQuery, Redshift, Trino |
| Serving baixa latência | Consulta pontual rápida | ClickHouse, Druid, Pinot, Redis, key-value store |
| Orquestração | Coordenar e agendar | Airflow, Dagster |
| Qualidade | Validar antes de publicar | Frameworks de teste, checks no pipeline |
| Catálogo e governança | Metadados, acesso, lineage | Catálogo do provedor, Unity, DataHub, OpenMetadata |

Uma distinção que rende muito e que candidatos raramente fazem: **serving analítico ≠ serving de baixa latência**. Um warehouse responde consultas complexas em segundos sobre bilhões de linhas, mas não serve 10.000 requisições por segundo de um produto. Para isso, você precisa de um banco de baixa latência alimentado pelo pipeline. Reconhecer isso quando o cenário envolve um produto voltado ao usuário é um diferencial claro.

---

## 2. Cenários resolvidos

### 🟡 Cenário 1 — Pipeline analítico de e-commerce

**Enunciado típico:** *"Desenhe a plataforma de dados de um e-commerce. Eles querem dashboards de vendas, análise de comportamento e alimentar um modelo de recomendação."*

**Clarificação.** Volume de pedidos por dia? Quantos eventos de navegação? Latência aceitável para os dashboards — diária basta ou precisa ser intradiária? A recomendação é em tempo real na sessão ou pré-calculada em batch? Quais fontes existem — banco transacional, eventos de front-end, ERP, plataforma de marketing? Há PII envolvida?

*Premissas que eu assumiria:* 100 mil pedidos/dia, 50 milhões de eventos de navegação/dia, dashboards com atualização horária suficiente, recomendação pré-calculada diariamente com features servidas em baixa latência, e presença de PII (cliente).

**Estimativa.** 50 milhões de eventos × 1 KB ≈ 50 GB/dia brutos; ~7 GB/dia em Parquet; ~2,5 TB/ano. Pedidos são desprezíveis em volume. Conclusão: volume modesto, o desafio é arquitetura e qualidade, não escala.

**Arquitetura.**

*Ingestão.* Dois caminhos distintos, e explicar por que são distintos é parte da resposta.

Do banco transacional (pedidos, clientes, produtos): **CDC**, porque preciso capturar updates e deletes — um pedido muda de status várias vezes, e polling por `updated_at` perderia estados intermediários e não capturaria deleções. Chave da mensagem = chave primária, para preservar ordem por entidade.

Dos eventos de front-end: coleta via SDK para um tópico de eventos. Volume alto, mas cada evento é imutável e independente, então append puro basta.

*Armazenamento em camadas.* Bronze com o dado bruto append-only, particionado por data de ingestão — é o meu ponto de reprocessamento se a lógica mudar. Silver limpo, deduplicado, tipado, com sessões reconstruídas a partir dos eventos e o espelho das entidades derivado do CDC. Gold modelado dimensionalmente.

*Modelagem na Gold.* Star schema. Fato de itens de pedido no grão de item — escolho o grão atômico porque sempre posso agregar para cima e nunca desagregar. Fato de eventos de navegação no grão de evento. Dimensões de cliente, produto, data e canal, com **SCD Tipo 2 em cliente e produto**, porque preciso que uma venda antiga seja atribuída à categoria e ao segmento vigentes na época, não aos atuais.

*Processamento.* Batch horário para a camada analítica. SQL no warehouse ou Spark, dependendo do que o time já opera — e eu perguntaria isso, porque introduzir uma tecnologia nova custa mais do que a diferença de performance na maioria dos casos desse porte.

*Serving.* Warehouse para BI. Para as features de recomendação, uma camada de baixa latência — key-value store ou feature store — alimentada pelo batch, porque o produto não pode consultar o warehouse a cada requisição de usuário.

*Governança.* PII isolada na dimensão de cliente com mascaramento por papel; identificador substituto nas fatos.

**Aprofundamento provável — "como você reconstrói sessões?"** Agrupo eventos por usuário ordenados por event time e quebro sessão quando o gap entre eventos excede 30 minutos, que é a convenção usual — e confirmaria com o negócio, porque esse número é uma decisão deles. Em batch, isso é uma window function com `LAG` para calcular o gap e uma soma cumulativa para gerar o ID de sessão. Os pontos difíceis: sessões que cruzam a fronteira do dia, que exigem olhar uma janela com sobreposição em vez de processar cada dia isoladamente; usuários anônimos que depois logam, exigindo reconciliação de identidade; e eventos atrasados de dispositivos móveis offline, que podem chegar horas depois e reabrir uma sessão já fechada — o que eu trataria com uma janela de lookback no reprocessamento diário.

**Falhas e operação.** Monitorar lag do CDC e saúde do slot de replicação — slot abandonado enche o disco da produção, que é um incidente no banco, não no pipeline. Testes de qualidade com write-audit-publish: unicidade de pedido, integridade referencial contra as dimensões, volume comparado ao mesmo dia da semana anterior (sazonalidade semanal em e-commerce é fortíssima, comparar com ontem gera falso positivo todo domingo), e reconciliação da receita total contra o sistema transacional. Idempotência por partição de data para permitir reprocessamento. Alerta por SLA de freshness, não só por falha.

---

### 🔴 Cenário 2 — Detecção de fraude em tempo real

**Enunciado típico:** *"Desenhe um sistema que detecta transações fraudulentas em tempo real."*

**Clarificação.** Qual o volume de transações por segundo, no pico? Qual a latência máxima aceitável para a decisão — a transação espera pela resposta? A decisão é bloquear automaticamente ou sinalizar para revisão humana? Qual o custo relativo de falso positivo versus falso negativo? O modelo já existe ou faz parte do escopo? Que features ele precisa?

*Premissas:* 5.000 transações/s no pico, latência máxima de 200 ms com a transação bloqueada esperando, decisão automática de bloqueio acima de um limiar e revisão humana na faixa intermediária, modelo já treinado.

**A observação que muda o design, e que deve vir cedo:** se a transação espera pela resposta, isto **não é um pipeline de dados** — é um serviço síncrono de baixa latência com um pipeline de dados por trás. Confundir os dois é o erro central desse cenário. O caminho de decisão precisa ser um serviço; o pipeline alimenta as features e treina o modelo.

**Arquitetura.**

*Caminho síncrono (decisão).* A transação chega ao serviço de scoring. Ele consulta um **feature store online** — um key-value store com latência de poucos milissegundos — para obter as features pré-calculadas do cliente, do dispositivo e do comerciante. Calcula as features que só existem no momento (valor da transação, hora, geolocalização, distância em relação à transação anterior), roda o modelo e devolve a decisão. Orçamento de latência: leitura de features ~10 ms, inferência ~20 ms, sobra folga confortável dentro dos 200 ms.

*Caminho assíncrono (atualização de features).* Toda transação é publicada num tópico. Um job de streaming consome e atualiza as features agregadas em janela — "número de transações deste cartão nos últimos 5 minutos", "valor médio na última hora", "número de países distintos hoje" — e escreve no feature store online. Aqui, sim, é streaming de verdade, com estado por chave e watermark.

*Caminho batch (treino e features lentas).* Os mesmos eventos vão para o data lake. Dali saem o treino do modelo, as features de janela longa (comportamento de 90 dias), e a análise de performance do modelo.

*Feedback.* Confirmações de fraude e contestações voltam como rótulos, alimentando o retreino. Sem esse laço, o sistema degrada silenciosamente conforme os padrões de fraude mudam — e isso deve ser dito, porque é o que separa quem já colocou modelo em produção.

**Pontos que o entrevistador vai cutucar:**

*"E se o feature store estiver indisponível?"* Preciso de um comportamento de degradação definido: usar um modelo mais simples com apenas as features da própria transação, ou aplicar uma política padrão. E essa política é uma decisão de negócio — em caso de indisponibilidade, aprova tudo (risco de fraude) ou bloqueia tudo (risco de perder receita legítima e irritar clientes)? Eu perguntaria em vez de assumir, e a resposta usual é aprovar com limite de valor reduzido.

*"Como garante consistência entre as features de treino e as de inferência?"* Este é o **training-serving skew**, e é o problema mais importante e mais subestimado do cenário. Se a feature "média dos últimos 30 dias" é calculada de um jeito no batch de treino e de outro no streaming online, o modelo recebe em produção uma distribuição diferente da que viu no treino, e a performance despenca sem erro nenhum aparecer. Mitigações: definir a feature uma vez só e derivar as duas implementações da mesma especificação; usar um feature store que gere ambas; e — o mais confiável — validar continuamente comparando a distribuição das features online com a do treino.

*"Como lida com dado atrasado no cálculo das features?"* Watermark curto, porque a decisão é agora e uma feature ligeiramente desatualizada é melhor que uma feature tardia. Dados que chegam depois corrigem a feature para as próximas transações, não para a que já foi decidida — e isso é aceitável e precisa ser declarado.

*"Exactly-once é necessário aqui?"* Para a decisão, não: cada transação é processada uma vez pelo serviço síncrono. Para as features agregadas, duplicatas inflam contadores, então preciso de deduplicação por ID de transação — mas at-least-once com dedup por chave é suficiente e muito mais barato que transações.

---

### 🔴 Cenário 3 — Migrar um data warehouse legado para a nuvem

**Enunciado típico:** *"A empresa tem um Oracle/Teradata on-premise com 15 anos de pipelines. Você foi contratado para migrar. Como conduz?"*

Este cenário testa julgamento e gestão de risco mais do que tecnologia, e é comum em vagas sênior.

**Clarificação.** Qual a motivação real — custo, performance, fim de suporte, escalabilidade, ou decisão corporativa já tomada? Qual o volume e quantos pipelines? Quantos consumidores e quais são críticos? Há prazo imposto? O time atual conhece a nuvem alvo? Existe documentação e lineage? Qual o apetite a risco de interrupção?

**A primeira resposta que impressiona:** não é sobre tecnologia, é sobre **sequenciamento e risco**. Migração big bang de um warehouse de 15 anos falha com altíssima probabilidade, porque ninguém sabe tudo que depende dele. A abordagem correta é incremental, com convivência.

**Plano.**

*Fase 0 — Descoberta.* Inventariar tabelas, pipelines e consumidores. A fonte mais confiável são os **logs de acesso**, não a documentação nem as entrevistas — a documentação está desatualizada e as pessoas superestimam o que usam. Tipicamente, uma fração grande dos objetos não é acessada há meses. Classificar por criticidade e por acoplamento. Essa fase revela o escopo real, e frequentemente descobre que 30% do sistema pode simplesmente ser aposentado — o que muda o projeto inteiro.

*Fase 1 — Definir a arquitetura alvo e a estratégia por objeto.* Para cada pipeline, uma decisão entre: **rehost** (mover como está, rápido e sem ganho arquitetural), **refactor** (reescrever aproveitando as capacidades novas), **replace** (substituir por ferramenta gerenciada) ou **retire** (aposentar). Migrar tudo com refactor é caro demais e migrar tudo com rehost desperdiça a migração. A mistura é a resposta, e a proporção depende de criticidade e de vida útil esperada.

*Fase 2 — Convivência (strangler fig).* Replicar os dados para o novo ambiente e rodar os dois em paralelo. Migrar por domínio, começando pelo menos crítico e mais autocontido, para aprender com baixo risco. Cada domínio migrado tem o resultado **comparado automaticamente** entre os dois sistemas por um período — diff de linhas e de métricas-chave. Essa comparação automatizada é o mecanismo central de segurança e o que permite migrar com confiança; sem ela, cada corte é um salto no escuro.

*Fase 3 — Corte por consumidor.* Redirecionar dashboards e consumidores gradualmente, com possibilidade de rollback. Manter o legado disponível até a confiança estar estabelecida.

*Fase 4 — Descomissionamento.* Só quando o uso do legado for comprovadamente zero, medido, não presumido.

**Riscos a levantar espontaneamente — é isso que se avalia aqui:**

*Divergência de resultados.* Diferenças de tipo, de arredondamento, de tratamento de NULL, de collation e de fuso horário entre os sistemas produzem números ligeiramente diferentes. Isso destrói a confiança do usuário mesmo quando o novo está mais correto. Precisa ser antecipado, medido e explicado.

*Lógica não documentada.* Regras de negócio embutidas em procedures de 15 anos que ninguém entende e cujo autor saiu da empresa. É a maior fonte de atraso em migrações reais.

*Consumidores desconhecidos.* Sempre existem — uma planilha crítica de alguém, um script que roda numa máquina esquecida, uma integração com um sistema de terceiros. Por isso o descomissionamento precisa ser medido, não presumido.

*Modelo de custo diferente.* On-premise é custo fixo já pago; nuvem é variável e proporcional ao uso. Uma consulta ineficiente que era invisível passa a ter fatura. Sem FinOps desde o começo, a migração "econômica" fica mais cara — e esse é um resultado comum e embaraçoso.

*Capacitação do time.* Migrar tecnologia sem migrar competência produz um sistema novo operado com práticas antigas.

**O que eu recomendaria explicitamente:** não tratar como projeto de migração pura. Aproveitar para consertar o que estava errado — testes de qualidade, lineage, ownership, contratos — nos domínios que serão refatorados de qualquer forma. Mas **não** tentar consertar tudo, porque migração com escopo aberto não termina. Definir o que está fora de escopo é tão importante quanto definir o que está dentro.

---

### 🔴 Cenário 4 — Métricas de produto para milhões de usuários

**Enunciado típico:** *"Desenhe o sistema de analytics de um produto com 50 milhões de usuários ativos. O time de produto precisa de funis, retenção e testes A/B."*

**Clarificação.** Quantos eventos por usuário por dia? Latência aceitável — os dashboards de produto precisam ser de hoje ou de ontem basta? Quantos analistas consultam e com que frequência? Precisa de análise ad hoc ou só de dashboards pré-definidos? Há necessidade de análise por coorte e por usuário individual, ou só agregada? Retenção do histórico?

*Premissas:* 50 milhões de usuários ativos, 50 eventos/usuário/dia = 2,5 bilhões de eventos/dia. Latência de horas é aceitável para produto; testes A/B precisam de leitura diária.

**Estimativa.** 2,5 bilhões × 1 KB ≈ 2,5 TB/dia brutos; em Parquet comprimido, ~300 GB/dia; ~110 TB/ano. Média de ~29.000 eventos/s, pico talvez 100.000/s. **Aqui a escala é real e dita o design**, ao contrário do cenário 1.

**Arquitetura.**

*Ingestão.* SDK no cliente com batching e retry local (essencial em mobile, onde a conexão é intermitente) enviando para um endpoint de coleta que escreve em Kafka. Kafka dimensionado para 100.000 eventos/s no pico — com cerca de 10 MB/s por partição como referência conservadora, isso demanda partições na casa das dezenas a poucas centenas. Chave = `user_id`, para preservar ordem por usuário, o que importa para reconstruir funis e sessões.

*Deduplicação.* Retry no cliente gera duplicatas com certeza. Cada evento carrega um `event_id` gerado no cliente, e a deduplicação acontece na ingestão dentro de uma janela — não globalmente, porque manter estado de bilhões de IDs para sempre é inviável.

*Armazenamento.* Object storage com formato de tabela, particionado por data e por tipo de evento. Clustering por `user_id` dentro da partição, porque análise de funil e de retenção agrupa por usuário e isso melhora muito o pruning.

*Processamento.* Batch horário ou diário para as tabelas modeladas. Não vejo necessidade de streaming: nenhuma decisão de produto é tomada em segundos. Se surgir a demanda de monitoramento operacional em tempo real, adiciono um caminho de streaming apenas para métricas agregadas de saúde, não para toda a análise.

*Camada de serving — a decisão mais importante aqui.* Analistas fazendo consultas ad hoc sobre 110 TB no warehouse é caro e lento. A resposta é uma combinação:

Tabelas **pré-agregadas** para as perguntas conhecidas — DAU/MAU por segmento, funis padrão, coortes de retenção. Responde a maior parte das perguntas por uma fração do custo.

Um banco **OLAP de baixa latência** (ClickHouse, Druid, Pinot) para exploração interativa, alimentado pelo batch. Esses bancos são projetados exatamente para esse padrão: consultas agregadas sobre eventos com latência sub-segundo.

O **lake completo** disponível para análises profundas e não antecipadas, aceitando que essas são mais lentas e mais caras.

*Testes A/B.* Atribuição de variante registrada como um evento no momento da exposição, não inferida depois — inferir atribuição é uma fonte clássica de viés. A análise junta exposição com eventos de conversão, e o cálculo de significância estatística é feito sobre isso.

**Aprofundamentos prováveis:**

*"Como calcula retenção D1/D7/D30 eficientemente?"* Materializo uma tabela de atividade diária por usuário — uma linha por usuário por dia ativo, que é muito menor que a tabela de eventos. A partir dela, retenção é um self-join ou uma window sobre um dataset já reduzido em ordens de grandeza. Calcular retenção direto sobre 110 TB de eventos crus a cada consulta é o erro que torna o sistema caro.

*"E `COUNT(DISTINCT user_id)` sobre bilhões de linhas?"* Exato é caro porque exige shuffle de todos os IDs distintos, e não é incrementalmente combinável — você não pode somar distintos de dois dias para obter o distinto do período. Uso **HyperLogLog**: um esboço probabilístico com erro tipicamente abaixo de 2%, que é **mergeable** — posso calcular o esboço por dia e combinar para qualquer período sem reprocessar os eventos. Para métricas de produto, 2% de erro é irrelevante e a economia é de ordens de grandeza. Ofereceria o cálculo exato como opção sob demanda para os poucos casos que exijam (relatório financeiro, por exemplo).

*"Como lida com evento de schema variável?"* Eventos de produto evoluem constantemente e cada tipo tem propriedades diferentes. Uso um schema base comum — `event_id`, `user_id`, `event_name`, `timestamp`, contexto de dispositivo — mais um campo de propriedades semiestruturado. Com um tipo variant ou com colunas materializadas para as propriedades mais consultadas, tenho flexibilidade sem perder performance. E um Schema Registry com compatibilidade validada, senão o time de produto quebra a análise sem saber.

---

## 3. Perguntas de entrevista sobre design

### 🟡 P1. Como você decide entre batch e streaming num projeto novo?

*Resposta modelo:* Pela pergunta "qual decisão é tomada com esse dado e em quanto tempo?". Se ninguém age em menos de um dia, streaming é custo sem retorno.

Streaming se justifica quando existe uma ação cujo valor decai rapidamente — bloquear uma fraude, recomendar na sessão, disparar um alerta operacional. E o custo é grande: estado para manter e recuperar, reprocessamento muito mais difícil, testes mais complexos, operação 24/7 e mudança de código com estado sendo dolorosa.

Meu padrão é começar em batch e migrar só o que tiver justificativa clara. Também considero micro-batch a cada 5–15 minutos como meio-termo, que atende a maior parte do que as pessoas chamam de tempo real com uma fração da complexidade — e frequentemente é uma mudança de agendamento, não de arquitetura.

---

### 🟡 P2. Como você estimaria a infraestrutura necessária para um pipeline novo?

*Resposta modelo:* Começo pelo volume: eventos por segundo no pico (não a média — pico costuma ser 2 a 5× a média), tamanho médio do evento, e daí volume diário e anual, aplicando o fator de compressão do formato alvo, que costuma ser de 5 a 10× para Parquet sobre JSON.

Com isso derivo três coisas. O **storage**, que é a conta mais simples e geralmente a menos preocupante. O **compute de processamento**, estimado pelo volume por janela dividido pelo throughput que um nó processa, com folga. E o **throughput de ingestão**, que define partições do Kafka ou paralelismo do coletor — e é frequentemente o gargalo real, mais que o volume total.

Depois verifico o caminho de leitura, que muita gente esquece: quantos usuários consultam, com que frequência, e quanto cada consulta varre. Um sistema pode ser trivial na escrita e caro na leitura.

E declaro explicitamente as premissas e o que aconteceria se o volume crescesse 10× — porque o que se avalia aqui é o raciocínio quantitativo, não a exatidão do número.

---

### 🔴 P3. Como você projetaria um sistema que precisa servir tanto BI quanto um produto voltado ao usuário?

*Resposta modelo:* São padrões de acesso incompatíveis, e a primeira coisa é dizer isso. BI faz poucas consultas complexas varrendo muito dado, com latência de segundos aceitável. Um produto faz milhares de requisições por segundo, cada uma lendo pouquíssimo, com latência de dezenas de milissegundos exigida. Nenhum sistema serve bem os dois.

Então eu separaria as camadas de serving compartilhando o pipeline de processamento: uma fonte de verdade no lake/warehouse, e duas materializações a partir dela. Para BI, tabelas modeladas no warehouse. Para o produto, uma camada de baixa latência — key-value store, banco OLAP de latência sub-segundo, ou cache — com apenas os dados e agregados que o produto consome, no formato exato em que ele consome.

Os pontos que eu levantaria: **consistência entre as duas** — elas vão divergir temporariamente, e é preciso definir quanto é aceitável e como se detecta divergência; **caminho de atualização**, se é o mesmo job escrevendo nos dois ou uma cascata; e **SLA diferente**, porque o produto é caminho crítico de usuário e precisa de disponibilidade e alerta em outro patamar. E deixaria explícito que a camada do produto é derivada, não uma segunda fonte de verdade — senão em dois anos existem duas verdades.

---

### 🔴 P4. Como você decidiria construir versus comprar em cada camada da plataforma?

*Resposta modelo:* Meu viés padrão é **comprar ou usar gerenciado**, e construir apenas onde há diferenciação real. O custo de construir é sistematicamente subestimado porque as pessoas comparam o esforço de fazer funcionar com o preço da ferramenta, ignorando manutenção, plantão, evolução e o custo de o autor sair da empresa.

Eu compraria: ingestão de fontes comuns (conectores de SaaS e de bancos são commodity e horríveis de manter), orquestração, catálogo, observabilidade e o warehouse. Nada disso diferencia o negócio.

Eu construiria: lógica de negócio e modelagem, que são por definição específicas; integrações com sistemas proprietários da empresa; e qualquer coisa onde a escala ou o requisito seja tão fora do comum que as ferramentas de mercado não atendam — o que é mais raro do que os engenheiros gostam de achar.

Os critérios que eu aplicaria: isso é diferenciação competitiva ou infraestrutura? Qual o custo total em 3 anos, incluindo o tempo do time? Qual o custo de sair depois, se a escolha for errada? O time tem capacidade de manter isso quando quem construiu não estiver mais aqui?

E acrescentaria uma consideração de fase: startup pequena deve comprar quase tudo, porque tempo de engenharia é o recurso mais escasso. Empresa grande com escala atípica pode ter caso econômico para construir componentes específicos — e frequentemente esse caso aparece quando a fatura da ferramenta gerenciada passa a ser maior que o custo de um time dedicado.

---

### 🔴 P5. Seu pipeline principal falhou e o dashboard executivo não vai atualizar hoje. O que você faz?

*Resposta modelo:* Nesta ordem, e a ordem é o que se avalia.

**Comunicar antes de resolver.** Avisar os consumidores imediatamente, com o que se sabe e uma estimativa mesmo que grosseira. Descobrir sozinho que o dado está velho é muito pior que ser avisado. Isso leva dois minutos e preserva confiança.

**Deixar claro o estado do dado.** Um dashboard com dado de ontem sem indicação disso é pior que um dashboard indisponível, porque alguém decide achando que é de hoje. Marcar como desatualizado é ação de contenção e vem antes do diagnóstico.

**Diagnosticar com foco em restaurar, não em entender.** A pergunta imediata é "consigo entregar o dado de hoje?", não "por que quebrou?". Se há um caminho de contorno — reprocessar parcialmente, entregar um subconjunto crítico, usar uma fonte alternativa — ele vale mais agora.

**Restaurar, validar antes de publicar.** Republicar dado errado depois de uma falha é o cenário que realmente destrói confiança.

**Comunicar a normalização** e o que mudou.

**Depois, e só depois, o post-mortem** — sem culpados, focado em: por que não foi detectado antes, por que a recuperação foi lenta, e o que muda para não repetir. Cada incidente desses deveria virar um teste ou um alerta novo.

O que eu evitaria é sumir para investigar e reaparecer três horas depois com a causa raiz. Durante um incidente, comunicação vale mais que velocidade de diagnóstico.

---

## 4. Erros que reprovam nessa rodada

**Começar a desenhar sem clarificar.** É o erro mais comum e o mais fatal. A pergunta é vaga de propósito.

**Não fazer estimativas.** Sem números, o design é opinião. E as estimativas frequentemente revelam que o gargalo não é onde você imaginava.

**Escolher tecnologia antes de definir o problema.** "Vou usar Kafka, Spark e Snowflake" antes de saber o volume e a latência mostra que você aplica um padrão decorado.

**Superdimensionar.** Propor Kafka, Flink e um lakehouse para 100 mil eventos por dia sinaliza falta de julgamento. Reconhecer que um Postgres e um cron resolveriam, e explicar em que ponto isso deixaria de valer, é uma resposta muito mais forte.

**Apresentar solução sem trade-off.** Toda escolha custa algo. Se você não menciona o custo, o entrevistador conclui que você não o conhece.

**Só desenhar o caminho feliz.** Sem falar de falha, retry, reprocessamento, monitoramento e custo, o design é de júnior.

**Não gerenciar o tempo.** Gastar 30 minutos na ingestão e não chegar em serving nem em operação. Declare a estrutura no começo e vá vigiando.

**Não perguntar sobre PII e regulação.** Em muitos domínios isso restringe a arquitetura de forma decisiva, e lembrar disso espontaneamente pesa.

**Ignorar o time e o contexto.** A melhor arquitetura para um time de 3 pessoas é diferente da melhor para 30. Perguntar sobre o time mostra maturidade.

**Não assumir uma posição.** Listar cinco opções sem escolher é evasivo. Escolha, justifique pelo requisito, e diga sob que condição você mudaria de ideia.

**Defender a escolha até a morte.** Se o entrevistador aponta um problema real, incorpore. Ele frequentemente está testando se você raciocina ou se apenas defende.

**Confundir serving analítico com serving de baixa latência.** Propor que um produto consulte o warehouse a cada requisição de usuário é um erro conceitual visível.

**Esquecer o custo.** Em 2026, custo é requisito de primeira classe. Um design que ignora quanto vai custar é incompleto.

---

## 5. Checklist mental para a rodada

Antes de terminar, confira se você tocou em:

- [ ] Requisitos funcionais e casos de uso, com escopo do que ficou de fora
- [ ] Volume, taxa de pico, crescimento e retenção — com números
- [ ] Latência exigida, justificada por uma decisão de negócio
- [ ] Fontes e método de ingestão (batch, CDC, streaming) com justificativa
- [ ] Camadas de armazenamento e formato
- [ ] Modelo de dados e **grão** das tabelas centrais
- [ ] Processamento e onde ele roda
- [ ] Serving, separando analítico de baixa latência se aplicável
- [ ] Idempotência e estratégia de reprocessamento/backfill
- [ ] Qualidade: quais testes, onde rodam, o que bloqueia
- [ ] Falhas: o que quebra, como se detecta, como se recupera
- [ ] Monitoramento e SLA — incluindo atraso, não só falha
- [ ] PII, acesso e conformidade
- [ ] Custo, em ordem de grandeza
- [ ] Como isso evolui se o volume crescer 10×
- [ ] Trade-offs assumidos explicitamente, e o que você faria diferente com mais tempo ou mais time
