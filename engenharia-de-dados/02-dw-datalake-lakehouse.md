# 02 — Data Warehouse, Data Lake e Lakehouse

> Diferenças reais · Schema-on-read vs schema-on-write · Formatos de tabela (Iceberg, Delta, Hudi) · Data mesh · Quando usar cada arquitetura

---

## 1. Resumo conceitual

### 1.1 A história explica a arquitetura

Você responde muito melhor a este tópico se souber *por que* cada coisa apareceu, em vez de decorar uma tabela comparativa.

**Data warehouse (anos 80–90).** Storage e compute eram caros e acoplados: um appliance (Teradata, Netezza, Exadata) com discos e CPUs no mesmo caixote. Como cada byte custava, você só guardava dado que já sabia que ia usar, já limpo e já modelado. Daí **schema-on-write**: a estrutura é definida e validada no momento da ingestão. O resultado é um sistema com governança forte, performance excelente, SQL maduro, e uma limitação óbvia — se você quiser fazer uma pergunta nova sobre um dado que não foi modelado, o dado simplesmente não está lá. E escalar significava comprar outro appliance.

**Data lake (2010s).** Hadoop e depois o object storage em nuvem (S3, GCS, ADLS) mudaram a economia: storage virou quase gratuito e desacoplado do compute. Surge a tese oposta — guarde **tudo**, bruto, em arquivos, e decida a estrutura na hora de ler (**schema-on-read**). Isso destravou dado semiestruturado e não estruturado (JSON, logs, imagens, áudio), machine learning, e a possibilidade de fazer perguntas que não foram antecipadas.

O problema é que, sem as garantias que o warehouse dava, muitos data lakes viraram **data swamps**: sem catálogo, ninguém sabia o que existia; sem schema enforcement, arquivos com formatos incompatíveis conviviam na mesma pasta; sem transações, um job que falhava no meio deixava dado parcial visível; sem controle de qualidade, ninguém confiava nos números. E o dado bruto exigia trabalho pesado antes de virar resposta.

**Lakehouse (final dos 2010s até hoje).** A tentativa de ter os dois: dado em object storage aberto e barato, em formato colunar aberto (Parquet), **mais** uma camada de metadados transacional por cima que devolve as garantias do warehouse — ACID, schema enforcement e evolution, time travel, upserts e deletes eficientes. Essa camada é o que chamamos de **formato de tabela**: Apache Iceberg, Delta Lake, Apache Hudi.

O lakehouse não é uma ferramenta, é um padrão arquitetural. A percepção correta é: **o formato de tabela é o que transforma um monte de arquivos Parquet num sistema com semântica de banco de dados.**

### 1.2 Comparação estruturada

| Dimensão | Data Warehouse | Data Lake | Lakehouse |
|---|---|---|---|
| Dado | Estruturado, curado | Qualquer tipo, bruto | Qualquer tipo, com camada curada |
| Schema | On-write (validado na ingestão) | On-read (interpretado na leitura) | On-write na camada de tabela, on-read na bruta |
| Storage | Proprietário, acoplado ao engine | Object storage, arquivos abertos | Object storage, formato aberto |
| Transações | ACID nativo | Nenhuma | ACID via formato de tabela |
| Custo de storage | Alto | Muito baixo | Muito baixo |
| Engines que leem | Um (o do fornecedor) | Vários, sem coordenação | Vários, com coordenação transacional |
| Usuário típico | Analista, BI | Cientista de dados, engenheiro | Ambos |
| Risco principal | Rigidez e custo | Virar swamp | Complexidade operacional |
| Governança | Forte, embutida | Precisa ser construída | Suportada pelo formato + catálogo |

### 1.3 Schema-on-write vs schema-on-read: o trade-off real

Esta é a pergunta conceitual mais importante do tópico, e a maioria das respostas é rasa.

**Schema-on-write** move o custo de validação para a ingestão. Consequências: dado ruim é rejeitado na porta de entrada; quem lê tem garantia de estrutura; consultas são mais rápidas porque o engine conhece os tipos com antecedência; e mudar o schema é caro, porque exige migração. A rigidez é o preço da confiança.

**Schema-on-read** move o custo para a leitura. Consequências: ingestão é rápida e nunca falha por formato; você preserva informação que ainda não sabe usar; mas **cada consumidor** paga o custo de interpretar, e — o ponto crítico — **cada consumidor pode interpretar de forma diferente**. É aí que a inconsistência nasce. Dois times leem o mesmo JSON e discordam sobre o que significa um campo ausente.

O insight que impressiona: schema-on-read não elimina o schema, ele **move a responsabilidade e a fragmenta**. O schema sempre existe; a pergunta é se ele é declarado e aplicado num lugar só, ou implícito e reimplementado N vezes. É exatamente por isso que o lakehouse aplica schema na camada de tabela — para reconsolidar essa responsabilidade — e por isso contratos de dados (ver arquivo 11) viraram tema.

### 1.4 Formatos de tabela: o que Iceberg, Delta e Hudi realmente fazem

Um formato de tabela é uma especificação de **metadados** que fica sobre arquivos de dados (quase sempre Parquet). Ele resolve problemas que um diretório de arquivos não resolve:

**Qual é o conjunto de arquivos que compõe a tabela agora?** Sem formato de tabela, "a tabela" é "tudo que está nesse prefixo do S3" — o que significa que um job escrevendo agora torna dados parciais visíveis, e listar milhões de objetos é lento e caro. Com formato de tabela, existe um manifesto explícito: a versão N da tabela é *esta lista de arquivos*. Isso dá **atomicidade** (a nova versão só fica visível quando o commit troca o ponteiro) e **isolamento de snapshot** (leitores em curso continuam vendo a versão antiga, consistente).

**Como fazer UPDATE e DELETE em arquivos imutáveis?** Parquet não permite alterar uma linha. Duas estratégias:
- **Copy-on-Write (CoW)**: reescreve o arquivo inteiro que contém a linha afetada. Escrita cara, leitura rápida (nada extra a fazer). Bom para tabelas com leitura frequente e escrita rara.
- **Merge-on-Read (MoR)**: grava um arquivo de delta (delete file, deletion vector ou log de mudanças) e resolve na leitura. Escrita barata, leitura mais cara até a compactação rodar. Bom para ingestão frequente e upserts em alto volume.

Saber explicar CoW vs MoR é o diferencial nesta parte. É um trade-off de write amplification versus read amplification, e a resposta correta depende da razão leitura/escrita da tabela.

**Como consultar o passado?** Cada commit gera um snapshot. Time travel é consultar o estado da tabela em um snapshot ou timestamp anterior — útil para auditoria, para reprodutibilidade de modelos de ML, e para rollback quando um pipeline escreveu lixo.

**Como evoluir o schema sem reescrever tudo?** Formatos modernos rastreiam colunas por **ID**, não por posição ou nome. Isso permite adicionar, remover e renomear colunas de forma segura, sem reescrever arquivos antigos e sem risco de leitura desalinhada.

**Como particionar sem obrigar o usuário a saber da partição?** O Iceberg introduziu **hidden partitioning**: a partição é derivada de uma coluna real por uma transformação declarada (por exemplo, `day(event_timestamp)`), e o engine aplica o pruning automaticamente quando você filtra por `event_timestamp`. No modelo antigo do Hive, você precisava filtrar explicitamente pela coluna de partição (`WHERE dt = '2026-08-14'`) ou a query varria tudo — uma das maiores fontes de custo acidental em data lakes. O Iceberg também permite **partition evolution**: mudar o esquema de particionamento sem reescrever dados históricos.

**Estado do ecossistema (2026):** Iceberg é uma escolha inicial forte para lakehouses novos e abertos, pela adoção ampla em catálogos e engines — não uma resposta automática. O spec v3 trouxe deletion vectors, tipo variant para semiestruturado, row lineage e tipos geoespaciais. Delta Lake, originado no Databricks, é maduro e tem o UniForm, que expõe tabelas Delta como Iceberg para leitores externos. Hudi mantém vantagem específica em cargas de upsert frequentes com Merge-on-Read; também oferece partial updates que gravam só as colunas alteradas em configurações compatíveis, reduzindo write amplification. A tendência é de **convergência**: os três formatos vêm adotando ideias semelhantes, e a discussão importante inclui "qual catálogo" — porque é o catálogo que participa do commit, do controle de acesso e da interoperabilidade entre engines.

Numa entrevista, se você não trabalhou com os três, seja honesto e responda pelos conceitos: CoW vs MoR, snapshot isolation, hidden partitioning, schema evolution por ID de coluna. Isso vale mais do que citar recursos de release notes.

### 1.5 Catálogo: a peça que candidatos esquecem

O **catálogo** é o serviço que mapeia nomes de tabela para a localização de seus metadados e que arbitra os commits. Sem ele, dois writers podem sobrescrever o trabalho um do outro, porque object storage historicamente não oferece operação de compare-and-swap confiável.

Opções: Hive Metastore (o legado, ainda onipresente), AWS Glue Data Catalog, Unity Catalog (Databricks), Polaris/Snowflake Open Catalog, Nessie (com semântica de branches tipo Git), e o **Iceberg REST Catalog**, que virou a interface padronizada e é o que permite trocar de implementação sem reescrever pipelines.

O catálogo é também onde vive a **governança**: controle de acesso por tabela, coluna e linha, políticas de mascaramento, e lineage. Mencionar o catálogo como componente distinto do formato mostra que você entende a arquitetura de verdade — muita gente trata "Iceberg" como se fosse uma coisa só.

### 1.6 Data lakehouse na prática: camadas

A organização mais comum é a **arquitetura Medallion**:

- **Bronze (raw)**: dado ingerido como veio, sem transformação, com metadados de ingestão (origem, timestamp, arquivo de origem). Append-only. Serve como fonte de verdade para reprocessamento — se a lógica de negócio mudar, você reprocessa do Bronze sem precisar reler da origem.
- **Silver (cleansed / conformed)**: dado limpo, tipado, deduplicado, com regras de qualidade aplicadas, chaves resolvidas e entidades conformadas entre fontes. É onde a maior parte da engenharia acontece.
- **Gold (curated / serving)**: dado agregado e modelado para consumo — normalmente star schemas, métricas de negócio, features para ML.

Os nomes vêm do vocabulário Databricks, mas o padrão é antigo (raw / staging / mart). O valor real das camadas é ter um ponto de reprocessamento: se você só tem o dado final e a lógica estava errada, você depende da origem ainda ter o histórico — e frequentemente ela não tem.

Uma nuance que vale citar: camadas custam dinheiro e latência. Três cópias do dado e três jobs de transformação. Em pipelines simples, colapsar Bronze e Silver é uma decisão legítima. O erro é adotar a arquitetura como ritual.

### 1.7 Data Mesh e Data Fabric

**Data Mesh** (Zhamak Dehghani) não é uma tecnologia, é um modelo **organizacional**, e essa é a primeira coisa a dizer. Quatro princípios:

1. **Propriedade por domínio**: o time que gera o dado é responsável por ele, em vez de um time central de dados ser gargalo para todos.
2. **Dado como produto**: cada dataset tem dono, SLA, documentação, versionamento e consumidores tratados como clientes.
3. **Plataforma self-service**: um time de plataforma provê a infraestrutura para que os domínios publiquem dados sem reinventar tudo.
4. **Governança federada e computacional**: padrões globais (identidade, formatos, políticas de acesso) aplicados automaticamente, com autonomia local dentro deles.

O problema que resolve é real: o time central de dados vira gargalo e não tem contexto de negócio suficiente sobre 40 domínios diferentes. O risco é igualmente real: sem governança federada forte e sem uma plataforma madura, mesh vira "cada time faz o que quer", que é o silo de sempre com nome novo. A resposta madura numa entrevista é reconhecer que mesh exige maturidade organizacional alta e que a maioria das empresas que dizem estar fazendo mesh está apenas descentralizando sem os contrapesos.

**Data Fabric** é mais um termo de fornecedor: uma camada de integração e metadados que unifica acesso a dados espalhados, frequentemente com automação e catálogo ativo. Onde mesh é descentralização organizacional, fabric é unificação tecnológica. Não são mutuamente exclusivos, e nenhum dos dois é obrigatório para fazer engenharia de dados bem feita.

### 1.8 Como escolher (a parte que vira pergunta de arquitetura)

**Data warehouse puro (Snowflake, BigQuery, Redshift) se:** o dado é majoritariamente estruturado e vem de sistemas transacionais; os consumidores são BI e analistas SQL; a equipe é pequena e não quer operar infraestrutura; governança e performance previsível importam mais que flexibilidade. É a escolha certa para a maioria das empresas que não são de tecnologia — e dizer isso mostra pragmatismo.

**Data lake / lakehouse se:** há volume alto de dado semiestruturado ou não estruturado; ML é caso de uso de primeira classe; você quer evitar lock-in de fornecedor no formato de storage; múltiplos engines precisam ler o mesmo dado; o custo de storage no warehouse virou proibitivo.

**Ambos (o mais comum na prática):** lake/lakehouse para ingestão bruta, processamento pesado e ML; warehouse ou camada Gold do lakehouse servindo BI. O dado flui do lake para o warehouse, ou o warehouse lê o lakehouse via tabelas externas. Reconhecer que a resposta usual é "os dois, em camadas" é mais forte do que defender uma escolha binária.

Note também a convergência: Snowflake e BigQuery leem e escrevem Iceberg; Databricks oferece warehouse SQL; a distinção entre as categorias está se dissolvendo na prática. A pergunta que sobra é menos sobre categoria e mais sobre **onde ficam os dados, quem controla o formato, e qual engine paga a conta do compute**.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Qual a diferença entre data warehouse e data lake?**

*Resposta modelo:* Warehouse guarda dado estruturado, já limpo e modelado, com schema aplicado na escrita, em storage otimizado e acoplado ao engine — otimizado para BI e SQL, com governança forte. Data lake guarda qualquer tipo de dado, bruto, em object storage barato e aberto, com schema interpretado na leitura — otimizado para flexibilidade, ML e casos que você ainda não antecipou. O warehouse te dá confiança ao custo de rigidez; o lake te dá flexibilidade ao custo de governança que você precisa construir.

*Follow-up:* "Qual o principal risco do data lake?" → Virar data swamp: sem catálogo, schema enforcement, transações ou qualidade, o dado existe mas ninguém sabe o que é nem confia nele. O custo de armazenar é baixo; o custo de não conseguir usar é alto.

---

**🟢 P2. O que é schema-on-read e schema-on-write?**

*Resposta modelo:* Schema-on-write valida a estrutura no momento da ingestão — dado fora do formato é rejeitado, e quem lê tem garantia. Schema-on-read grava qualquer coisa e interpreta a estrutura na hora da consulta. O trade-off é onde o custo de validação cai: na entrada (ingestão mais lenta e rígida, leitura confiável) ou na saída (ingestão rápida, mas cada consumidor paga o custo e pode interpretar diferente). O ponto que costuma passar batido é que schema-on-read não elimina o schema — ele fragmenta a responsabilidade entre N consumidores, e é daí que vem a inconsistência.

---

**🟢 P3. O que é um lakehouse?**

*Resposta modelo:* É um padrão arquitetural que junta o storage barato e aberto do data lake com as garantias transacionais do warehouse. Na prática: dados em Parquet no object storage, mais um formato de tabela (Iceberg, Delta, Hudi) que adiciona uma camada de metadados provendo ACID, schema enforcement e evolution, time travel, e upserts/deletes eficientes. O que transforma um monte de arquivos numa tabela de verdade é essa camada de metadados — não o formato dos arquivos.

---

### 🟡 Intermediário

**🟡 P4. O que um formato de tabela como Iceberg ou Delta resolve que Parquet puro não resolve?**

*Resposta modelo:* Parquet é formato de **arquivo**: define como um arquivo guarda dados colunares. Não diz nada sobre quais arquivos compõem uma tabela. Sem formato de tabela, "a tabela" é o conteúdo de um prefixo do storage, o que gera três problemas: escritas não são atômicas (um job que falha no meio deixa dado parcial visível); não há isolamento (um leitor pode pegar um estado inconsistente); e listar objetos para descobrir o que existe é lento e caro em escala.

O formato de tabela mantém um manifesto explícito de quais arquivos formam cada versão da tabela. Isso dá atomicidade (o commit troca o ponteiro de versão), snapshot isolation, time travel, schema evolution segura por ID de coluna, e UPDATE/DELETE eficientes em arquivos imutáveis.

*Follow-up muito comum:* "Como se faz DELETE numa tabela Iceberg se Parquet é imutável?" → Duas estratégias. Copy-on-write reescreve os arquivos que contêm as linhas afetadas e registra a nova lista no commit. Merge-on-read grava um arquivo de delete (ou deletion vector) e aplica o filtro na leitura, com compactação posterior consolidando. CoW encarece a escrita e mantém a leitura rápida; MoR faz o oposto. A escolha depende da razão leitura/escrita da tabela.

---

**🟡 P5. O que é hidden partitioning e por que importa?**

*Resposta modelo:* No modelo Hive tradicional, a partição é uma coluna física separada (`dt`), e o usuário precisa filtrar explicitamente por ela para haver pruning. Se ele filtra por `event_timestamp` e não por `dt`, a query varre a tabela inteira — uma das maiores fontes de custo acidental em data lakes, porque falha silenciosamente: a query devolve o resultado certo, só que caríssima.

Com hidden partitioning, a partição é declarada como uma **transformação** de uma coluna real (`day(event_timestamp)`). O usuário filtra pela coluna natural e o engine deriva o pruning sozinho. Além disso, o esquema de particionamento pode evoluir sem reescrever dados históricos, porque cada arquivo carrega no metadado o esquema com que foi escrito.

---

**🟡 P6. O que é time travel e para que serve na prática?**

*Resposta modelo:* Cada commit na tabela gera um snapshot identificável, então você pode consultar o estado em um snapshot ou timestamp anterior. Usos reais: auditoria e compliance ("o que a tabela dizia no fechamento do mês?"); reprodutibilidade de ML (treinar de novo exatamente com os dados de então); depuração ("quando esse número mudou?"); e rollback quando um pipeline escreveu dado errado — você reverte o ponteiro em vez de reprocessar tudo.

*Follow-up crítico:* "Isso não faz o storage crescer indefinidamente?" → Sim, e por isso existe expiração de snapshots e limpeza de arquivos órfãos, que precisa rodar como manutenção periódica. O trade-off é janela de time travel versus custo de storage — em compliance, a retenção às vezes é obrigatória; no resto, 7 a 30 dias costuma bastar. Esquecer essa manutenção é um problema operacional real: além do custo, o metadado cresce e a listagem de snapshots degrada a performance de planejamento das queries.

---

**🟡 P7. Quando você recomendaria um data warehouse em vez de um lakehouse?**

*Resposta modelo:* Quando o dado é majoritariamente estruturado e relacional, os consumidores são BI e analistas SQL, a equipe é pequena e não quer operar infraestrutura, e previsibilidade de performance e governança importam mais que flexibilidade de formato. Boa parte das empresas que não são de tecnologia está exatamente nesse caso, e montar um lakehouse ali é complexidade sem retorno.

Eu iria para lakehouse quando houvesse volume alto de dado semiestruturado ou não estruturado, ML como caso de uso de primeira classe, necessidade de múltiplos engines lendo o mesmo dado, preocupação com lock-in de formato, ou quando o custo de storage no warehouse virasse proibitivo.

Na prática a arquitetura mais comum é híbrida, e vale dizer isso: lake para ingestão bruta e processamento pesado, warehouse ou camada Gold servindo BI.

---

**🟡 P8. Explique a arquitetura Medallion. Ela é sempre necessária?**

*Resposta modelo:* Bronze é o dado bruto como veio, append-only, com metadados de ingestão. Silver é o dado limpo, tipado, deduplicado e conformado entre fontes. Gold é o dado agregado e modelado para consumo. O valor central não é a nomenclatura, é ter um ponto de reprocessamento: se a lógica de negócio mudar ou tiver um bug, você reprocessa a partir do Bronze sem depender de a origem ainda ter o histórico — e frequentemente ela não tem.

Não é sempre necessária. Cada camada custa storage, compute e latência. Em pipelines simples com origem confiável e transformação leve, colapsar Bronze e Silver é uma decisão legítima. O erro é aplicar a arquitetura como ritual, criando três cópias de um dado que passa por uma transformação trivial.

---

### 🔴 Avançado

**🔴 P9. Copy-on-Write ou Merge-on-Read? Como você decide?**

*Resposta modelo:* É um trade-off entre write amplification e read amplification.

CoW reescreve os arquivos de dados que contêm as linhas afetadas. Se você atualiza 100 linhas espalhadas por 100 arquivos de 500 MB, reescreve 50 GB para mudar 100 linhas. Em compensação, a leitura é limpa: os arquivos já refletem o estado final, sem trabalho de merge.

MoR grava só o delta (delete file ou deletion vector, mais os novos registros) e resolve o merge na leitura. A escrita é barata e rápida, mas cada leitura paga o custo de aplicar os deltas, e esse custo cresce até a compactação rodar.

Decido pela razão leitura/escrita e pela latência exigida. Tabela com ingestão frequente de upserts (CDC de um OLTP, por exemplo) e consulta esporádica: MoR, senão a ingestão não acompanha. Tabela atualizada uma vez por dia e consultada milhares de vezes: CoW, porque o custo de escrita é amortizado e a leitura fica ótima. Se precisar dos dois, MoR com compactação agressiva agendada é o meio-termo — e aí a compactação vira um job de primeira classe, com custo e monitoramento próprios, não um detalhe.

*Follow-up:* "O que acontece se a compactação não rodar em MoR?" → O número de delete files e arquivos pequenos cresce, o planejamento da query fica caro, e a leitura degrada progressivamente. É uma falha silenciosa: nada quebra, só fica cada vez mais lento e caro, até alguém investigar.

---

**🔴 P10. Como você garante consistência quando múltiplos writers escrevem na mesma tabela do lakehouse?**

*Resposta modelo:* Via **controle de concorrência otimista** no commit. Cada writer lê a versão atual dos metadados, faz seu trabalho, e tenta commitar uma nova versão condicionada à versão que leu não ter mudado. Se outro writer commitou nesse meio-tempo, o commit falha e o writer precisa revalidar e tentar de novo. Isso exige uma operação atômica de compare-and-swap no ponteiro da tabela, que é justamente o papel do **catálogo** — historicamente, object storage puro não oferecia essa garantia, e é por isso que catálogo não é um detalhe opcional da arquitetura.

O impacto prático é que conflito não é erro, é o mecanismo normal — mas se muitos writers disputam a mesma tabela, você entra em retry storm e a taxa de commit despenca. As mitigações são particionar a escrita para que writers não toquem os mesmos arquivos, serializar escritas por partição, ou consolidar escritores num único job de merge. Se a operação for append puro, os conflitos são muito mais raros, porque nenhum writer invalida os arquivos do outro — o que é um argumento a favor de desenhar pipelines como append + merge posterior em vez de N writers fazendo upsert concorrente.

---

**🔴 P11. O que é Data Mesh e qual sua opinião sobre adotá-lo?**

*Resposta modelo:* Data Mesh é um modelo organizacional, não uma tecnologia — essa distinção é o principal. Quatro princípios: propriedade por domínio, dado tratado como produto (com dono, SLA, documentação e consumidores como clientes), plataforma self-service, e governança federada e computacional.

O problema que ele resolve é real: um time central de dados vira gargalo e não tem contexto de negócio suficiente sobre dezenas de domínios. Mas a adoção exige maturidade que a maioria das empresas não tem: sem plataforma self-service madura e sem governança automatizada, mesh vira descentralização sem contrapesos, o que é o silo de sempre com nome novo — e agora sem ninguém responsável pela consistência entre domínios.

Eu recomendaria mesh para organizações grandes, com múltiplos domínios de negócio genuinamente independentes, times de dados dentro dos domínios e um time de plataforma capaz. Para empresas menores, o time central funciona melhor e a sobrecarga de coordenação do mesh não se paga. O que eu adotaria em qualquer tamanho é o princípio de "dado como produto": dono explícito, contrato, SLA e documentação — isso tem valor independente da estrutura organizacional.

---

**🔴 P12. Sua empresa tem um data lake em S3 que virou um data swamp. Como você resolveria?**

*Resposta modelo:* Eu trataria como problema de governança, não de tecnologia — trocar de ferramenta sem mudar o processo recria o swamp em seis meses. A sequência que eu seguiria:

**Primeiro, inventário e triagem.** Descobrir o que existe, quem escreveu, quem lê (logs de acesso do storage são ótimos para isso) e o que ninguém acessa há meses. Uma fração grande de qualquer swamp é dado morto, e deletar ou arquivar reduz o problema antes de resolvê-lo.

**Segundo, catálogo e ownership.** Todo dataset que fica precisa ter dono nomeado, descrição e classificação de sensibilidade. Sem dono, ninguém corrige nada, e a entropia vence.

**Terceiro, estabelecer zonas com regras diferentes.** Uma zona bruta append-only onde vale quase tudo, e uma zona curada onde só entra dado com schema declarado, testes de qualidade e dono. Isso evita a paralisia de tentar limpar tudo de uma vez e cria um caminho claro de promoção.

**Quarto, migrar a zona curada para formato de tabela** (Iceberg, por exemplo), o que traz schema enforcement, transações e time travel, e — importante — impede que o problema volte, porque escrever fora do padrão passa a falhar em vez de simplesmente funcionar mal.

**Quinto, políticas operacionais:** ciclo de vida e expiração, compactação de arquivos pequenos, e testes de qualidade rodando como parte do pipeline, não como auditoria posterior.

**Sexto, e o que realmente decide o resultado:** mudar o processo de entrada. Enquanto qualquer pessoa puder despejar arquivos no bucket sem contrato, o swamp se reconstitui. Isso é uma conversa de organização e de incentivos, não de ferramenta — e é a parte que a maioria dos planos de migração ignora.

---

**🔴 P13. Iceberg, Delta ou Hudi? Como você escolheria hoje?**

*Resposta modelo:* Em 2026, para um lakehouse novo e aberto, eu usaria Iceberg como baseline de avaliação — ele tem forte neutralidade de fornecedor, suporte amplo de engines e catálogos, e uma interface REST Catalog que reduz acoplamento. Mas confirmaria primeiro os engines, o catálogo, os padrões de escrita e a capacidade operacional da equipe. O spec v3 trouxe deletion vectors, tipo variant, row lineage e tipos geoespaciais.

Delta faz sentido quando a empresa já está no ecossistema Databricks: a integração é mais profunda e o UniForm permite que leitores externos consumam a tabela como Iceberg. Hudi mantém vantagem específica em upserts frequentes com Merge-on-Read e, quando partial updates são habilitados e suportados pela configuração, pode gravar somente as colunas alteradas para reduzir write amplification.

Dito isso, os três estão convergindo e adotando as ideias uns dos outros, então eu não trataria a escolha como decisão de uma década. O que eu consideraria mais importante que o formato é **o catálogo**, porque é ele que arbitra commits, controla acesso e determina quais engines conseguem ler — e trocar de catálogo é mais doloroso que trocar de formato. Também pesaria muito o que os engines que a empresa já usa suportam nativamente, porque interoperabilidade real vale mais que a lista de features no papel.

---

**🔴 P14. Warehouse e lakehouse estão convergindo. Isso significa que a distinção acabou?**

*Resposta modelo:* A distinção de *categoria de produto* está se dissolvendo — Snowflake e BigQuery leem e escrevem Iceberg, Databricks oferece SQL warehouse, e a maioria dos fornecedores atende os dois casos. Mas as perguntas de arquitetura por trás continuam válidas, e são elas que importam:

**Onde o dado fisicamente vive e quem controla o formato?** Se está em formato aberto no seu bucket, você pode trocar de engine. Se está em formato proprietário, migrar significa exportar tudo. Isso é uma decisão de risco de longo prazo, não de performance.

**Quem paga o compute e como ele escala?** Modelos de compute desacoplado permitem isolar cargas e pagar por uso; modelos acoplados dão performance mais previsível.

**Onde o schema é aplicado?** Ainda existe diferença real entre um sistema que rejeita dado fora do contrato e um que aceita tudo.

Então eu diria: a distinção comercial acabou, a distinção arquitetural não. E numa entrevista de arquitetura, o que se avalia é se você raciocina sobre essas três perguntas, não se conhece o posicionamento de marketing dos fornecedores.

---

## 3. Armadilhas comuns

**Confundir formato de arquivo com formato de tabela.** Parquet é formato de arquivo; Iceberg e Delta são formatos de tabela que ficam **por cima** do Parquet. Dizer "usamos Iceberg em vez de Parquet" revela que a arquitetura não foi entendida — Iceberg usa Parquet.

**Achar que data lake é "onde a gente joga arquivo".** Um data lake sem catálogo, sem contrato e sem ciclo de vida é um bucket. A definição de data lake inclui governança; sem ela é swamp por definição.

**Dizer que o lakehouse elimina o data warehouse.** Muitas empresas rodam os dois, e para muitas o warehouse puro continua sendo a resposta correta. Absolutismo arquitetural é um sinal de inexperiência.

**Esquecer o catálogo.** Candidatos descrevem lakehouse como "Parquet + Iceberg no S3" e param aí. Sem catálogo não há coordenação de commits nem controle de acesso. É componente de primeira classe.

**Ignorar manutenção de tabela.** Compactação de arquivos pequenos, expiração de snapshots e limpeza de arquivos órfãos não são opcionais — sem elas, o custo cresce e a performance degrada de forma silenciosa. Mencionar isso espontaneamente sinaliza experiência operacional real.

**Tratar schema-on-read como ausência de schema.** O schema existe sempre; a questão é se é declarado num lugar ou reimplementado por cada consumidor. Essa confusão é a raiz de metade dos problemas de qualidade em data lakes.

**Confundir Data Mesh com tecnologia.** Mesh é modelo organizacional. "Implementamos data mesh com a ferramenta X" é contradição em termos — ferramenta nenhuma cria ownership de domínio.

**Assumir que time travel é grátis.** Snapshots retêm arquivos que seriam deletados. Sem política de expiração, o storage cresce sem limite e o metadado degrada o planejamento das queries.

**Superestimar o custo de join em lakehouse moderno.** Engines com AQE e broadcast join lidam bem com dimensões pequenas. Justificar desnormalização extrema com "join é caro" sem qualificar tamanho e distribuição rende contra-argumento.

**Descrever Bronze/Silver/Gold como obrigatório.** É convenção útil, não lei. Aplicá-la a um pipeline trivial triplica custo e latência sem ganho — e um bom entrevistador vai testar exatamente se você aplica padrão sem pensar.
