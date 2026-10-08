# StudyForge video renderer

Renderer isolado que consome `StudyLesson` v1. Não lê Markdown/quiz nem importa CLI de StudyForge. Por padrão, usa somente trechos e referências da própria aula; o perfil didático ED01/SCD é opt-in e recusa aulas sem conceito SCD ligado à fonte ED-01. `verificationStatus` e status de fontes externas não são promovidos.

## ABI

```js
import {renderVideo, createVideoRenderer} from './render.mjs';
await renderVideo(lesson, 'generated/video/domain/slug.mp4', options);
```

`createVideoRenderer()` cria instância com cache de bundle em memória; a instância compartilha o bundle entre diferentes `StudyLesson`/`inputProps`. A chave incorpora hash dos fontes do renderer, versões/configuração do pacote e hash/caminho público do asset de áudio. Uma falha de bundle rejeita a chamada e limpa a entrada para permitir retry. `sourceHash`, `renderHash` e `outputHash` separam identidade das fontes, composição e asset de áudio/codec.

Opções: `profile` (`generic` default; ou `ed01-scd`), `wpm` (145), `pauseSeconds` (8), `width`/`height` (1920/1080), `fps` (30), `audioFile` (WAV local), `captionsPath`, `timelinePath`, `browserExecutable` local opcional e `captureFrames` (`true` ou diretório). A API grava SRT e timeline ao lado do MP4 se os paths não forem informados. A CLI, sem paths explícitos, lê `generated/lessons/engenharia-de-dados/01-modelagem-de-dados.json`, salva vídeo em `generated/video/<domain>/<slug>.mp4` e SRT em `generated/captions/<domain>/<slug>.video.srt`. Passe outro JSON de `StudyLesson` como primeiro argumento; o segundo argumento opcional é o output MP4. Use `--profile=ed01-scd` explicitamente quando apropriado. `--capture-frames` salva stills das cenas presentes ao lado do MP4.

SRT e burn-in usam segmentos curtos (máx. 42 caracteres por linha, até duas linhas), distribuídos proporcionalmente às palavras da cena. São estimativas de leitura, **não** word-alignment de áudio. WAV é opcional, aceito apenas por caminho local e servido dentro do bundle via `staticFile`; nenhum TTS, serviço remoto ou URL de áudio. Se áudio exceder a aula, a cena final de referências é estendida.

Dependências, lockfile, scripts e TypeScript config ficam neste pacote isolado. Instale com `npm ci --prefix studyforge/video`. Primeiro render pode provisionar Chromium pelo Remotion se não houver `browserExecutable` compatível; em CI sem acesso de rede, forneça o binário local. Se os pacotes não estiverem instalados, execute `npm ci --prefix studyforge/video` antes de importar a API.

`npm test --prefix studyforge/video` executa testes unitários e smoke de MP4 com fixture WAV; `npm run typecheck --prefix studyforge/video` verifica `checkJs` nos módulos JSX/JS do renderer. `npm run render:ed01 --prefix studyforge/video` renderiza somente ED01 com perfil opt-in e `wpm=160` para o piloto; API e demais aulas mantêm `wpm=145` por padrão.

Remotion Free License permite uso individual; organizações com até 3 empregados e entidades sem fins lucrativos, segundo https://github.com/remotion-dev/remotion/blob/main/LICENSE.md (consultada em 2026-10-07). Outras organizações podem precisar Company License.
