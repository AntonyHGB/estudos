# Engenharia de Dados — Material para Entrevistas Técnicas

Material de estudo conceitual para entrevistas técnicas de Engenharia de Dados. O foco é **entender e defender conceitos**, não escrever código. Não há exercícios para rodar: há explicações densas, perguntas reais de entrevista com respostas modelo, follow-ups esperados e as armadilhas que derrubam candidatos.

---

## Como usar este material

**1. Faça um diagnóstico primeiro.**
Você não sabe seu nível hoje. Cada pergunta está marcada com dificuldade:

| Marca | Nível | O que significa |
|---|---|---|
| 🟢 | **Básico** | Esperado de qualquer candidato, inclusive júnior. Errar aqui elimina. |
| 🟡 | **Intermediário** | Nível pleno. Exige experiência prática e noção de trade-offs. |
| 🔴 | **Avançado** | Sênior / staff. Exige raciocínio sobre sistemas, falhas e decisões de arquitetura. |

Passe por cada arquivo lendo **só as perguntas**, sem ler as respostas. Responda em voz alta (isso importa — pensar e falar são habilidades diferentes). Marque cada pergunta:

- ✅ respondi bem e completo
- ⚠️ sei o conceito mas travei ou fui raso
- ❌ não sei

Se você acerta a maioria das 🟢 mas trava nas 🟡, seu nível é júnior/pleno-inicial. Se acerta as 🟡 com folga e trava nas 🔴, você está em pleno/sênior. Se as 🔴 são confortáveis, foque em `12-design-de-sistemas-de-dados.md`, que é onde entrevistas sênior realmente se decidem.

**2. Só depois leia o resumo conceitual.**
Ler antes de tentar responder cria a ilusão de que você sabe. Você reconhece o conteúdo, mas não consegue produzi-lo sob pressão. Tente responder primeiro, mesmo mal.

**3. Trabalhe as ⚠️ antes das ❌.**
Perguntas que você quase sabe rendem mais em menos tempo, e ⚠️ é justamente o que faz você parecer inseguro numa entrevista.

**4. Leia sempre a seção "Armadilhas comuns".**
É a seção de maior densidade por linha. São erros conceituais específicos que entrevistadores usam de propósito para separar quem decorou de quem entendeu.

**5. Fale em trade-offs, não em respostas finais.**
Quase nenhuma pergunta boa de engenharia de dados tem uma resposta certa. Tem uma resposta certa *dado um contexto*. A resposta que impressiona é sempre da forma: "depende de X; se X, então A por causa de Y; se não-X, então B, porque o custo de A vira Z". Se você responde só "use Kafka", perdeu a pergunta.

---

## Índice

| # | Arquivo | Tópico | Peso em entrevistas |
|---|---|---|---|
| 01 | [01-modelagem-de-dados.md](01-modelagem-de-dados.md) | OLTP vs OLAP, normalização, star/snowflake, SCD, Data Vault | ⭐⭐⭐⭐⭐ |
| 02 | [02-dw-datalake-lakehouse.md](02-dw-datalake-lakehouse.md) | Data warehouse, data lake, lakehouse, formatos de tabela | ⭐⭐⭐⭐ |
| 03 | [03-etl-elt-orquestracao.md](03-etl-elt-orquestracao.md) | ETL vs ELT, idempotência, backfill, reprocessamento, CDC | ⭐⭐⭐⭐⭐ |
| 04 | [04-batch-streaming.md](04-batch-streaming.md) | Batch vs streaming, event-driven, exactly-once, watermarks | ⭐⭐⭐⭐ |
| 05 | [05-sistemas-distribuidos.md](05-sistemas-distribuidos.md) | Particionamento, sharding, shuffle, data skew, CAP | ⭐⭐⭐⭐ |
| 06 | [06-sql-conceitual.md](06-sql-conceitual.md) | Window functions, joins, planos de execução, índices | ⭐⭐⭐⭐⭐ |
| 07 | [07-formatos-e-armazenamento.md](07-formatos-e-armazenamento.md) | Parquet, Avro, ORC, colunar, compressão, file sizing | ⭐⭐⭐ |
| 08 | [08-spark.md](08-spark.md) | Arquitetura, lazy evaluation, Catalyst, AQE, tuning | ⭐⭐⭐⭐ |
| 09 | [09-kafka.md](09-kafka.md) | Partições, consumer groups, offsets, retenção, EOS | ⭐⭐⭐⭐ |
| 10 | [10-airflow-orquestracao.md](10-airflow-orquestracao.md) | DAGs, scheduling, dependências, sensores, Airflow 3 | ⭐⭐⭐ |
| 11 | [11-qualidade-governanca.md](11-qualidade-governanca.md) | Qualidade, lineage, contratos de dados, LGPD/GDPR | ⭐⭐⭐ |
| 12 | [12-design-de-sistemas-de-dados.md](12-design-de-sistemas-de-dados.md) | A pergunta aberta de arquitetura + framework de resposta | ⭐⭐⭐⭐⭐ |

---

## Trilha sugerida de estudo

### Fase 1 — Fundamentos que sempre caem (semana 1–2)

Comece por aqui mesmo se você já é experiente. É o que mais aparece e o que mais gente erra por excesso de confiança.

1. **`01-modelagem-de-dados.md`** — a base de tudo. Se você não sabe explicar por que um data warehouse é desnormalizado, nada mais vai fazer sentido.
2. **`06-sql-conceitual.md`** — SQL cai em praticamente 100% das entrevistas. Foque em window functions e no custo de joins.
3. **`03-etl-elt-orquestracao.md`** — idempotência e backfill são o coração do trabalho diário. Entrevistadores adoram porque separa quem já operou pipeline em produção de quem só leu sobre.

**Marco de conclusão:** você consegue desenhar um star schema no papel e explicar SCD Tipo 2 sem consultar nada.

### Fase 2 — Arquitetura e plataforma (semana 3)

4. **`02-dw-datalake-lakehouse.md`** — vocabulário obrigatório de qualquer conversa de arquitetura moderna.
5. **`07-formatos-e-armazenamento.md`** — curto, mas rende muito. Explica *por que* o lakehouse funciona.
6. **`05-sistemas-distribuidos.md`** — é aqui que 🔴 começam a aparecer. Data skew e shuffle explicam metade dos problemas de performance que você vai discutir.

**Marco:** você explica por que Parquet é rápido em analytics e por que particionar por `user_id` num lake normalmente é má ideia.

### Fase 3 — Tempo real e ferramentas (semana 4–5)

7. **`04-batch-streaming.md`** — conceitos primeiro (event time, watermark, semânticas de entrega).
8. **`09-kafka.md`** — depois do 04, porque Kafka é a implementação concreta daqueles conceitos.
9. **`08-spark.md`** — arquitetura e otimização. Prepare-se para explicar um job lento.
10. **`10-airflow-orquestracao.md`** — mais raso conceitualmente, mas cai muito em entrevista de plataforma.

**Marco:** você explica a diferença entre at-least-once e exactly-once, e por que "exactly-once" quase nunca significa o que as pessoas acham que significa.

### Fase 4 — Sênior (semana 6)

11. **`11-qualidade-governanca.md`** — o que separa engenheiro de dados de "pessoa que escreve pipeline".
12. **`12-design-de-sistemas-de-dados.md`** — a rodada que define o nível da oferta. Faça pelo menos 3 dos cenários do arquivo em voz alta, cronometrado em 45 minutos.

---

## Trilha comprimida (entrevista em ~1 semana)

Se o tempo é curto, na ordem: `01` → `06` → `03` → `12` → `04` → `05`.

Esses seis cobrem a maior parte da superfície de uma entrevista técnica genérica. Os demais viram leitura de reforço.

---

## Ajuste por tipo de vaga

Nem toda vaga de "engenheiro de dados" pesa os mesmos tópicos. Descubra na conversa inicial qual é o perfil e reordene:

- **Analytics Engineering / dbt / BI-heavy** → 01, 06, 03, 11. Modelagem e SQL dominam; streaming quase não cai.
- **Plataforma / Big Data / Spark** → 05, 08, 07, 12. Esperam que você raciocine sobre performance e custo em escala.
- **Streaming / Real-time** → 04, 09, 05, 12. Semânticas de entrega e late data são o centro.
- **Cloud (AWS/GCP/Azure)** → 02, 07, 03, 12, mais serviços gerenciados específicos do provedor (Redshift/BigQuery/Snowflake, Glue/Dataflow/Databricks).
- **Vaga generalista / startup** → tudo, com foco em 12: eles querem alguém que decide arquitetura sozinho.

---

## Como responder bem (independente do tópico)

Cinco hábitos que valem mais que qualquer conteúdo específico:

**Estruture antes de falar.** Dois segundos de silêncio para organizar são melhores que trinta segundos divagando. "Vou separar em três partes: o que é, quando usar, e o trade-off principal."

**Diga o nome das coisas.** Falar "quando os dados ficam desbalanceados entre as partições" é ok. Falar "data skew" e depois explicar é melhor. Vocabulário preciso sinaliza experiência real.

**Dê números, mesmo aproximados.** "Um arquivo Parquet deve ter algo entre 128 MB e 1 GB" é infinitamente melhor que "arquivos não devem ser pequenos demais". Ordem de grandeza correta > precisão.

**Assuma o trade-off explicitamente.** Toda escolha custa algo. Se você apresenta uma solução sem custo, o entrevistador vai concluir que você não conhece o custo.

**Diga "não sei" quando não sabe — e continue.** A resposta forte é: "não conheço esse detalhe específico, mas pelo que sei de X, eu esperaria que funcionasse assim; e verificaria checando Y". Isso mostra raciocínio. Inventar comportamento de tecnologia é o erro mais fatal da lista, porque destrói a confiança em tudo que você disse antes.

---

## Nota sobre versões

O material reflete o estado do ecossistema em 2026: Kafka em modo KRaft (ZooKeeper removido a partir do Kafka 4.0), Spark 3.x/4.x com AQE ligado por padrão desde a 3.2, Airflow 3 com asset-aware scheduling e DAG versioning, e Apache Iceberg como formato de tabela padrão em lakehouses novos. Detalhes de versão mudam; os conceitos por trás, não. Nas entrevistas, priorize demonstrar o conceito e sinalize quando estiver falando de um comportamento específico de versão.
