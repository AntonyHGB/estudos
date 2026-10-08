# StudyForge: arquitetura e auditoria

StudyForge é um compilador de conhecimento para transformar fontes de estudo em artefatos rastreáveis. Produz MP4 via renderer integrado, não consulta LLM/API, não faz TTS de fornecedor e não substitui o site existente.

## Dois caminhos, fontes compartilhadas

```mermaid
flowchart LR
  MD[Markdown por domínio] --> SITE[build-site.mjs]
  Q[quiz.json] --> SITE
  SITE --> WEB[site estático: file:// e HTTP(S)]
  MD --> DISC[discovery e parser source-aware]
  Q --> DISC
  DISC --> CAN[StudyTopic canônico]
  CAN --> VALID[schemas JSON + validação runtime]
  VALID --> AUD[sidecar de auditoria + relatório]
  VALID --> LES[StudyLesson]
  AUD --> LES
  LES --> R[renderers: cards, HTML, PDF, roteiro/cues]
  LES --> VID[renderer de vídeo: MP4 + SRT + timeline]
```

O build antigo `node build-site.mjs` continua sendo o caminho do site: Markdown + quizzes produzem páginas estáticas auto-contidas que abrem em `file://`. O StudyForge é uma pipeline adicional, não uma migração desse site.

| Camada | Responsabilidade e limite |
|---|---|
| Sources | Markdown e quiz JSON permanecem as fontes editáveis. Discovery atual aceita `NN-*.md` (01–99) sob os dois diretórios de domínio definidos no modelo e o quiz correspondente. |
| Parser/model | Constrói `StudyTopic` preservando o Markdown bruto e particionando cada unidade de texto. IDs/anchors são estáveis em relação a caminho e âncora semântica; spans são offsets UTF-16 e linhas 1-based. |
| Validação | JSON Schema e `validateTopic()` verificam forma, partições, semântica declarada e integridade das referências do quiz. Isso não prova exatidão factual. |
| Audit | Registro manual versionado por tópico, ligado a hash/snapshot, spans, seção/anchor e, quando pertinente, JSON pointer. Relatórios mostram evidência/fonte e cobertura. Sem autoaplicação de mudanças. |
| Lesson/renderers | `StudyLesson` é a interface derivada comum. Renderers consomem o lesson validado e mantêm referências e determinismo; não reparseiam Markdown. |
| Cache | Fingerprints cobrem dependências de conteúdo, runtime, código/schema, sidecar de auditoria, opções e locks relevantes. Só pula quando input e hash do arquivo já escrito coincidem. Escritas derivadas são atômicas. |

## Formato e rastreabilidade

Parser conserva `rawMarkdown` exatamente como lido (LF, CRLF ou CR); spans do tópico se referem ao texto bruto. Partitions ordenadas cobrem integralmente o texto e classificam headings, parágrafos, listas, tabelas, código, citações, linhas vazias e perguntas/ênfase. Cercas não fechadas, linhas não classificadas e dificuldade não derivável geram warnings com caminho/linha/span/excerpt. Dificuldade desconhecida é `null` com motivo — nunca é inferida. O formato legado do arquivo de quiz (`n/q/a/c/e`) é importado por `parseQuiz` e normalizado no canonical: dificuldade/pergunta/alternativas/índice correto/explicação, com proveniência do tópico, ponteiro JSON, arquivo e hash. Verificar estrutura/referências do quiz não equivale a verificar fatos ou respostas.

Auditoria normaliza somente CRLF e CR para LF no snapshot lógico. Guarda hash lógico e proveniência/hash raw; portanto alteração de EOL sozinha não invalida conteúdo factual. Para claims, assertions e contexto precisam reproduzir exatamente o snapshot; o span remapeado deve cair na seção/anchor esperada. Os relatórios expõem hash/span raw atual e referência do snapshot. Um hash lógico diferente torna o registro stale e evidência externa não é reaproveitada nem remapeada automaticamente. Fontes externas são ligadas aos claims válidos e indicam URL HTTPS, tipo, título, `checkedAt` e localizador.

Estados de claim incluem `VERIFIED`, `NEEDS_SOURCE`, `NEEDS_REVIEW`, `OUTDATED` e `CONFLICTING`; `PROPOSED_CHANGE` é um tipo de proposta, não um atalho para editar a fonte. Em caso de registro estruturalmente inválido, binding incorreto ou snapshot stale, o relatório reduz confiança/propagação e marca revisão necessária. Mesmo `VERIFIED` não significa que o tópico inteiro foi revisado: cobertura de tema fica explicitamente parcial. Relatório/schema não substitui julgamento factual.

## Auditoria manual: adicionar e revisar claim

1. Leia o Markdown-fonte e identifique uma assertion literal pequena, o contexto e a seção de origem. Não copie evidência de outro tópico/snapshot.
2. Edite o sidecar autorado em `studyforge/audit/records/<domínio>/<arquivo>.audit.json`, usando hash atual, offsets do snapshot LF, linhas, context span, section ID e anchor corretos. Inclua justification e status apropriado. Para `VERIFIED`, registre fonte consultada de fato, evidência localizada, método/responsabilidade e datas válidas; limite `verifiedScope` ao texto sustentado.
3. Se a fonte mudou semanticamente, não force offsets antigos: marque para revisão/outdated e reavalie evidência. Não altere `checkedAt` por automação; só registre uma consulta/revisão real. Propostas descrevem original/proposto/motivo/fontes e não são aplicadas automaticamente.
4. Valide e gere relatório com `npm run study:verify -- dominio/NN`; veja saída em `generated/reports/<domínio>/`. Exit 2 indica cobertura/estado parcial, não falha de CI nem autorização para marcar todos verified. `--all` pode igualmente retornar 2.

O sample atual tem seis claims `VERIFIED`, três `NEEDS_SOURCE`, quatro `NEEDS_REVIEW` e uma proposta `PROPOSED_CHANGE`; é um snapshot da auditoria atual, não métrica de cobertura completa.

### Warning e span stale: depuração

- Comece por `npm run study:inventory -- --json` e `npm run study:validate`. Use o caminho, código, linha, span e excerpt do warning; confirme no Markdown fonte.
- `UNCLOSED_FENCE`: corrija a cerca na fonte se isso for realmente o erro. `UNCLASSIFIED_INTERVIEW`/dificuldade incerta: ajuste classificação declarada ou mantenha `null`; não invente interpretação.
- Em falha de quiz, confira arquivo/hash/JSON pointer, chave de tema e existência do módulo. O parser/runtime valida join; não edite o canonical gerado.
- Em audit stale, compare hash raw e lógico e depois assertion/contexto literalmente. EOL diferente é normalizado para o snapshot lógico, mas mudanças de conteúdo exigem revisão. O relatório não transporta fontes/evidências de registro estrangeiro ou stale.
- Registre fixtures de regressão cobrindo LF/CRLF/CR, offset de início/fim, contexto, mapeamento para seção/anchor e snapshots inválidos. O compilador TS não é substituto dessas validações.

## Build, renderers, ambiente

`study:build` deriva canonical, relatório, cards, HTML e roteiro/cues/captions estimados; PDF e vídeo são incluídos por padrão para um tópico, mas `--skip-pdf`, `--skip-video` ou `--text-only` os desativam. Em `--all`, saídas textuais são padrão; PDF e vídeo exigem `--pdf` e `--video`. O CLI também aceita `--video-profile=generic|ed01-scd`, `--video-wpm=N`, `--audio-file=CAMINHO_WAV` e `--browser-executable=CAMINHO` para `video`/`build --video`; `--wpm=N` e `--pause-seconds=N` ajustam roteiro/cues. `study:video` gera MP4, SRT e timeline. `study:audio` não sintetiza voz: gera roteiro/cues estimados/captions. Timestamps de vídeo são estimados, não alinhamento TTS. O renderer produz captions sem truncamento e fontes paginadas com URLs públicas completas. A instalação PDF é isolada (`npm run study:setup:print`) e requer browser explicitamente provisionado; vídeo também usa pacote/lock isolado (`npm run study:setup:video`). Smokes PDF (`study:test:pdf`) e testes/typecheck de vídeo (`study:test:video`, `study:typecheck:video`) são separados do core.

Vídeo integra `renderVideo(lesson, outputPath, options)` e `createVideoRenderer({bundleCache})`; CLI/pipeline chama o factory e produz MP4, SRT e timeline JSON. Pacote Remotion é isolado e instalado via lock próprio. Sem WAV opcional, vídeo não inclui áudio; WAV local pode ser passado com `--audio-file=...`. A cache incremental valida fingerprint da entrada e hashes dos três artefatos antes de pular render. Nenhum TTS ou serviço remoto é parte da pipeline.

Instalação root usa `npm ci` e dependências declaradas no package/lock (Ajv 8.20, markdown-it 15.0.2, highlight.js 11.12). `study:typecheck` verifica somente model/validator JS conforme configuração; lint é `node --check` nos arquivos listados, não análise de tipos abrangente. `study:test` roda os testes core; smoke PDF e testes/typecheck de vídeo são separados. Não se afirma execução remota de CI nem validação específica com Node 22.

### Saídas e cache

Saídas derivadas ficam sob `generated/` (canonical, lessons, reports, flashcards, HTML, PDF, scripts/captions, cache de parse/pipeline). A árvore exata depende dos comandos executados; isso não é inventário garantido de artefatos presentes. Não versionar browser cache/PDF/MP4. Retenha fontes, schemas, sidecars de auditoria e código-fonte; não apague saídas antigas apenas por serem ignoradas no Git.

Fingerprint do parser inclui Markdown, quiz do domínio, parser/model/validator, schemas, runtime e lock/package root. Fingerprint da pipeline inclui código de lesson/renderers/audit/print e schemas, sidecar, quiz, locks relevantes e runtime; opções de renderer entram quando afetam a saída. Vídeo mantém fingerprint de runtime e opções próprios, incluindo WAV/browser quando fornecidos, e só pula quando hashes de MP4, SRT e timeline coincidem. Assim alteração de quiz invalida a proveniência dos tópicos daquele domínio. Cache parse só é aceito se chave, caminho, hash e Markdown bruto coincidirem. Outputs existentes só são pulados quando fingerprint e hash do próprio output coincidem. Escritas usam arquivo temporário e rename; cache não autoriza mutar fonte.
