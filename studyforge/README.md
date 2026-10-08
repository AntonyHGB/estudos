# StudyForge

StudyForge é um compilador de conhecimento com proveniência: transforma Markdown e quizzes em registros canônicos validados, relatórios de auditoria, `StudyLesson` e artefatos renderizados. Não substitui o site estático atual nem afirma exatidão factual. O renderer de vídeo integrado produz MP4, captions SRT e timeline JSON.

## Fluxos

```text
Markdown + quiz.json ── build-site.mjs ──> site estático (abre em file://)
       └────────────── StudyForge ──> StudyTopic canônico
                                        ├─ auditoria + relatório
                                         └─ StudyLesson ──> renderers PDF/HTML/áudio/vídeo
```

O fluxo original do site permanece: `node build-site.mjs` usa os Markdown e quiz JSON e gera `index.html`/assets por área. A pipeline StudyForge é adicional: discovery → parse/normalização → validação → ligação da auditoria → `StudyLesson` → renderers. Nenhuma etapa chama LLM/API nem sintetiza fala por fornecedor.

## Modelo e limites

- `studyforge/model.mjs`, `types.d.ts` e schemas JSON definem/verificam `StudyTopic`, quiz normalizado e estruturas de auditoria/lição. Runtime usa Ajv 8.20.0; dependências root também incluem markdown-it 15.0.2 e highlight.js 11.12.0. TypeScript 7.0.2 e `@types/node` 26.6.4 estão configurados como devDependencies.
- Parser preserva Markdown bruto e partições lossless; spans são offsets UTF-16 e linhas 1-based. IDs/anchors estáveis usam caminho e âncora semântica. Warnings apontam origem e trecho; dificuldade não derivável permanece `null` com motivo.
- O formato de entrada de `quiz.json` é legado (`n/q/a/c/e`). `parseQuiz` o normaliza no modelo canônico para dificuldade, pergunta, alternativas, índice correto, explicação e proveniência (tópico, ponteiro JSON, arquivo/hash). Não confundir formato de importação com formato canônico; parsing/validação não constituem verificação factual.
- Discovery atual aceita `NN-*.md` (01–99) diretamente nos domínios `engenharia-de-dados/` e `machine-learning/`, definidos no código, mais `quiz.json` por domínio. Novo diretório sozinho não adiciona domínio. Inventário atual: 12 temas em cada domínio; 172 perguntas abertas/96 de quiz em ED; 121 abertas/96 de quiz em ML. Counts são variáveis. Cinco questões de calibração de ML têm dificuldade desconhecida: não inventar classificação.

## Comandos (PowerShell, raiz do repositório)

```powershell
npm ci
npm run study:inventory -- --json
npm run study:parse -- engenharia-de-dados/01
npm run study:parse -- --all
npm run study:validate
npm run study:verify -- engenharia-de-dados/01
npm run study:verify -- --all
npm run study:lesson -- engenharia-de-dados/01
npm run study:cards -- engenharia-de-dados/01
node studyforge/cli.mjs html engenharia-de-dados/01
npm run study:pdf -- engenharia-de-dados/01
npm run study:audio -- engenharia-de-dados/01
npm run study:video -- engenharia-de-dados/01
npm run study:build -- engenharia-de-dados/01
npm run study:build -- --all
npm run study:build -- --all --pdf
npm run study:test
npm run study:test:pdf
npm run study:typecheck
npm run study:lint
```

Comandos `lesson`, `cards`, `html`, `pdf`, `audio-script`, `video` e `build` aceitam `dominio/NN` ou `--all`. `parse` aceita também essas seleções; inventory aceita `--json`. `verify` retorna código 2 quando cobertura/auditoria permanece parcial; isso não significa que todo claim esteja verificado. `build` de um tópico inclui PDF e vídeo por padrão; `--skip-pdf`, `--skip-video` ou `--text-only` desativam mídia. `build --all` gera saídas textuais por padrão; `--pdf` e `--video` são opt-in. Vídeo standalone: `npm run study:video -- dominio/NN`.

`audio-script` produz texto, cues/duração estimados e captions; não gera áudio nem alinhamento de fala. Links/recursos locais dos renderers são resolvidos relativamente ao HTML de saída/repositório e funcionam sem serviço remoto. Arquivos binários de browser/PDF podem variar por ambiente/fontes/metadados; não assumir igualdade byte a byte desses binários. Artefatos textuais determinísticos são comparados por hash no cache.

### Dependências opcionais e testes

PDF usa pacote isolado `studyforge/print/`; `npm run study:setup:print` instala suas dependências via lockfile. Depois, provisionar explicitamente o browser Chromium/Puppeteer suportado pelo pacote, por exemplo `npm --prefix studyforge/print exec puppeteer browsers install chrome`. Downloads consomem quota/rede e podem falhar por ambiente; `npm ci` root não instala browser e não roda PDF/MP4 na CI. A instalação de scripts nativos/avisos de permissões deve ser avaliada pelo usuário, não contornada automaticamente.

Vídeo instala separadamente com `npm run study:setup:video` (lockfile próprio em `studyforge/video/`); PDF usa lockfile isolado em `studyforge/print/`. `npm run study:test:pdf` é smoke test separado e requer browser instalado. `npm run study:test:video` e `npm run study:typecheck:video` são separados. `study:test` roda somente testes core. Não afirmar execução de CI remoto ou teste com Node 22. `study:typecheck` verifica somente model/validator JS conforme configuração (não parser, CLI, testes ou todos os renderers); `study:lint` executa `node --check` em arquivos listados, não ESLint nem verificação de tipos abrangente.

## Auditoria e proveniência

Sidecars autorados ficam em `studyforge/audit/records/<domínio>/`. O snapshot lógico normaliza somente CRLF/CR para LF e preserva hash raw como proveniência. Cada claim liga assertion/contexto literais a hash, span, seção/anchor; relações de quiz incluem ponteiro JSON, arquivo e hash. Evidências/fonte externa só são propagadas quando o snapshot e binding são válidos; hashes stale/estrangeiros não são remapeados nem reaproveitados. `checkedAt` representa consulta/revisão real e relatórios não o atualizam. Propostas de alteração não são aplicadas automaticamente. Validação de schema e runtime verifica estrutura/integridade, não verdade factual nem cobertura total.

Ao incluir claim, selecione assertion literal e contexto do Markdown atual, calcule hash/span/linhas no snapshot lógico e associe seção/anchor. Use status adequado; `VERIFIED` exige escopo limitado, fonte externa consultada com localizador/data, evidência e método/responsabilidade. Execute `npm run study:verify -- dominio/NN` e examine `generated/reports/`. Se stale, reavalie manualmente; não ajuste offsets no escuro. Para warnings, `study:inventory -- --json` e `study:validate` mostram caminho/código/linha/span/excerpt; confirme e corrija a fonte ou mantenha desconhecido. Preserve fixtures cobrindo EOL, limites de spans, contexto e seção/anchor.

Piloto ED01 permanece `unverified`: 13 claims — 6 `VERIFIED`, 3 `NEEDS_SOURCE` e 4 `NEEDS_REVIEW`. Nenhuma correção factual é aplicada automaticamente; não representa cobertura integral auditada. Consulte [arquitetura e auditoria](docs/architecture.md).

## Cache e arquivos gerados

Fingerprint de parse considera Markdown, quiz do domínio, parser/model/validator, schemas, runtime e lock/package root. Fingerprint da pipeline inclui código/schema de dependências, auditoria, locks e opções de renderer pertinentes. Mudança no quiz invalida proveniência dos tópicos do domínio. Cache canônico só evita reparse quando chave e conteúdo/origem coincidem. Uma saída só é pulada se a chave de entrada e o hash do arquivo existente conferem. Escritas derivadas são atômicas.

Árvore relevante:

```text
studyforge/
├── README.md
├── cli.mjs, model.mjs, parser.mjs, validate.mjs, pipeline.mjs, cache.mjs
├── schemas/                 # topic, quiz, audit
├── lesson/                  # modelo StudyLesson e schema
├── renderers/               # HTML, cards e roteiro/captions
├── audit/                   # lógica, piloto, testes e records autorados
├── print/                   # integração opcional Puppeteer/PDF
├── docs/architecture.md
└── video/                   # renderer Remotion isolado com lock próprio

generated/                   # derivado e ignorado no Git
├── canonical/ lessons/ flashcards/ reports/ html/ pdf/
├── audio-scripts/ captions/ video/   # inclui MP4 e timeline quando vídeo é executado
└── .cache/                   # cache de parse e pipeline
```

Pastas de saída dependem dos comandos executados. Versione fontes, schemas, sidecars de auditoria e código, não caches de browser/PDF/MP4. Não apague saídas antigas apenas por estarem ignoradas.

## Extensão

Novo tópico: adicione `NN-slug.md` e quiz com chave/tema correspondente na área existente; deixe o parser gerar canonical. Novo renderer: aceite `StudyLesson`, preserve refs/IDs/hash e links de fonte, seja determinístico nas saídas textuais e inclua teste representativo/cache fingerprint. Exemplo de contrato: `renderStudyLesson(lesson, options) → { content, references }`; renderer não reabre/reinterpreta Markdown nem afirma verificação factual. Para extensão de domínio, altere discovery/model e testes conscientemente.

Áudio é desacoplado: `audio-script` gera roteiro, cues e captions com tempos estimados, sem TTS nem alinhamento a fala sintetizada. Vídeo também usa timestamps estimados; suas captions não são alinhamento de fala. O renderer gera captions sem truncamento e fontes paginadas com URLs públicas completas. O piloto ED01 segue `unverified`.
