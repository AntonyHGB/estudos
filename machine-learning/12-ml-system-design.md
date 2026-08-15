# 12 — ML System Design

> A pergunta aberta de arquitetura: recomendação, ranking, detecção de fraude, busca.
> É a rodada final da maioria dos processos sênior. Não existe resposta certa — o que se avalia é **estrutura de raciocínio, capacidade de fazer trade-offs explícitos, e se você já operou um sistema real**.

---

## 1. O framework de resposta

O erro fatal é começar falando de modelo. Um candidato que responde "eu usaria um transformer" nos primeiros 30 segundos já perdeu, porque pulou tudo que a pergunta está avaliando. **Um bom candidato passa os primeiros 10 minutos sem mencionar nenhum algoritmo.**

### Etapa 1 — Clarificar (5–10 min, obrigatório)

Faça perguntas antes de propor. A pergunta é subespecificada **de propósito**, e a qualidade das suas perguntas é metade da avaliação.

**Sobre o objetivo:**

- Qual métrica de negócio queremos mover? (Nunca aceite "melhorar o produto".)
- Como é o sucesso medido hoje? Existe algum sistema no lugar?
- Qual o custo relativo dos dois tipos de erro?

**Sobre escala e restrições:**

- Quantos usuários, itens, requisições por segundo? (Muda tudo: 100 QPS e 100k QPS são sistemas diferentes.)
- Orçamento de latência? (10ms, 200ms e "batch noturno" são arquiteturas diferentes.)
- Qual o volume de dados históricos?

**Sobre os dados:**

- Que dados existem hoje? Que rótulos existem, e com que atraso chegam?
- Quão limpos e confiáveis são?
- Existem restrições de privacidade ou regulação?

**Sobre o produto:**

- Onde a predição aparece na experiência? Quem consome — usuário final ou operador interno?
- Existe humano no loop?
- Cold start é relevante (usuários e itens novos)?

**Sobre o escopo da conversa:**

- "Devo focar na modelagem ou na arquitetura de sistema?" — pergunta legítima e mostra consciência do tempo.

### Etapa 2 — Enquadrar o problema de ML

Traduzir o problema de negócio numa formulação de ML **e defender a tradução**. É aqui que mora a maior parte do valor.

- **É mesmo um problema de ML?** Regras simples resolvem? Se resolvem, propor ML é um erro. Dizer isso em voz alta impressiona.
- **Qual a formulação?** Classificação binária, regressão, ranking, geração, detecção de anomalia? A mesma necessidade de negócio admite formulações diferentes com implicações completamente distintas.
- **Qual o rótulo, exatamente?** Esta é a pergunta mais importante do system design. O rótulo disponível é quase sempre um **proxy** do objetivo real (você quer "usuário satisfeito", tem "usuário clicou"), e discutir essa lacuna é o sinal mais forte de senioridade.
- **Qual a unidade de predição?** Por usuário, por par usuário-item, por transação, por sessão?
- **Métrica offline e métrica online**, e como elas se relacionam.

### Etapa 3 — Arquitetura de alto nível

Desenhe o fluxo completo antes de detalhar qualquer parte:

```
Fontes de dados → Ingestão → Feature pipeline (batch + streaming) → Feature store
                                                                          ↓
      Treino ← Rotulagem ← Logs de feedback                    Serviço de inferência
         ↓                                                              ↓
  Model registry → Validação/gate → Deploy (shadow → canary → A/B) → Aplicação
                                            ↑                            ↓
                                       Monitoramento  ←──────────  Logs + métricas
```

Marque explicitamente o que é **online** (no caminho da requisição) e o que é **offline** (batch).

### Etapa 4 — Aprofundar onde o entrevistador quiser

Pergunte: "quer que eu aprofunde em features, em modelagem, ou em serving?". Deixar o entrevistador dirigir é uma estratégia melhor do que adivinhar.

### Etapa 5 — Trade-offs, riscos e evolução

Termine sempre com: o que pode dar errado, o que você monitoraria, e qual seria a v2. Isso demonstra que você pensa em sistemas vivos, não em projetos.

**Regras de ouro:**

1. **Comece simples.** Baseline de regras → modelo linear → gradient boosting → deep learning, cada passo justificado por não ser suficiente. Ninguém é reprovado por propor um baseline; muita gente é reprovada por complexidade injustificada.
2. **Fale de trade-offs, não de escolhas.** "Eu usaria X" é fraco. "Eu usaria X, aceitando custo Y, porque a restrição Z é o que mais aperta aqui" é forte.
3. **Traga o custo.** Latência, computação, esforço de manutenção e complexidade operacional são parte da resposta.
4. **Volte ao negócio.** Toda decisão técnica termina em impacto.

---

## 2. Padrões que se repetem

### 2.1 A arquitetura de duas etapas (candidate generation → ranking)

É **o padrão mais importante de system design em ML** e resolve o mesmo problema em recomendação, busca, feed e anúncios: você não pode pontuar milhões de itens com um modelo caro dentro de 100ms.

**Etapa 1 — Geração de candidatos (recall).** De milhões para centenas. Modelos baratos, frequentemente múltiplas fontes em paralelo: busca por vizinhos aproximados sobre embeddings (two-tower), filtragem colaborativa, popularidade por segmento, regras de negócio, itens recentes. **Objetivo: recall alto** — o item certo precisa estar no conjunto. Precision aqui não importa.

**Etapa 2 — Ranking.** De centenas para dezenas. Modelo caro e rico em features, que agora pode se dar ao luxo de usar interações usuário-item, contexto e features em tempo real. **Objetivo: precision no topo.**

**Etapa 3 (comum) — Re-ranking / regras de negócio.** Diversidade, remoção de duplicatas, regras de conteúdo, boost de novidade, restrições de inventário, e balanceamento de objetivos múltiplos.

**Por que essa separação é elegante:** ela desacopla os requisitos. A geração de candidatos precisa ser barata e ter recall alto, e pode ser pré-computada. O ranking pode ser caro porque opera sobre poucos itens. Cada uma pode ser melhorada independentemente. E — ponto importante — **um erro na geração de candidatos é irrecuperável**: se o item certo não entrou, nenhum ranking o traz de volta. Por isso monitorar recall da geração de candidatos separadamente é essencial.

**Two-tower (dual encoder)** é a arquitetura padrão da geração de candidatos: uma torre codifica o usuário, outra o item, e a similaridade é um produto interno. A propriedade que a torna viável: os embeddings de item podem ser **pré-computados e indexados** num índice ANN, e só o embedding do usuário é computado em tempo real. O custo dessa arquitetura é que as torres não interagem, então ela não captura interações finas usuário-item — o que é exatamente o que o ranking faz depois.

### 2.2 Multi-objetivo

Quase todo sistema real tem objetivos concorrentes: engajamento vs. satisfação de longo prazo, relevância vs. diversidade, receita vs. experiência do usuário, precision vs. recall.

Abordagens: modelo separado por objetivo com combinação ponderada dos scores (mais simples de operar, pesos calibráveis por A/B); modelo multi-task com cabeças compartilhadas (mais eficiente, aprende representações comuns); ou otimização com restrições (maximizar A sujeito a B não cair de um limite).

**O ponto que impressiona:** os pesos entre objetivos são uma **decisão de produto, não estatística**. Eles devem ser expostos como parâmetros ajustáveis e calibrados por experimento, não escondidos no treino.

### 2.3 Humano no loop

Muitos sistemas de decisão não decidem — eles **priorizam trabalho humano**. Fraude, moderação, revisão de crédito, triagem médica. Isso muda três coisas:

1. **A métrica é precision no volume que a equipe processa**, não AUC global.
2. **A capacidade operacional define o limiar**, não uma otimização estatística.
3. **As decisões humanas geram rótulos** — o que é ótimo (rotulagem contínua e grátis) e perigoso (só se rotula o que foi alertado, o que enviesa o treino futuro).

### 2.4 Cold start

Presente em quase todo sistema com usuários e itens. Estratégias:

- **Conteúdo em vez de comportamento** — usar atributos do item/usuário, que existem desde o dia zero.
- **Popularidade / defaults por segmento** — baseline honesto e surpreendentemente forte.
- **Onboarding explícito** — pedir preferências ao usuário.
- **Exploração** — dar exposição deliberada a itens novos para coletar sinal, aceitando o custo de curto prazo.
- **Modelos híbridos** — combinar sinal de conteúdo e colaborativo, com peso que migra conforme o histórico se acumula.

Vale sempre segmentar a avaliação por cold start, porque a métrica agregada é dominada por usuários frequentes e esconde a falha.

---

## 3. Estudos de caso

---

### 3.1 🟡 Sistema de recomendação (ex.: "recomende produtos na home de um e-commerce")

**Clarificar:** Qual métrica — CTR, conversão, GMV, retenção? Quantos usuários e itens? Latência? Que sinais existem (visualizações, cliques, carrinho, compras, avaliações)? O catálogo muda rápido? Quantos itens exibimos?

**Enquadramento:** Ranking personalizado de itens por probabilidade de engajamento, com uma decisão importante logo de cara: **qual é o rótulo positivo?** Clique é abundante mas ruidoso e leva a clickbait; compra é escasso mas alinhado ao negócio; uma alternativa forte é multi-objetivo com pesos (clique como sinal denso para aprendizado, compra como objetivo de valor). Eu levantaria explicitamente que otimizar CTR de curto prazo tende a degradar satisfação, e proporia retenção ou valor de sessão como métrica de decisão.

**Arquitetura de duas etapas:**

*Geração de candidatos* — múltiplas fontes em paralelo, cada uma cobrindo uma fraqueza da outra: two-tower com busca ANN sobre embeddings (cobertura semântica e personalização), filtragem colaborativa item-item (o clássico "quem comprou isto também comprou", forte e barato), popularidade por segmento (cobre cold start), itens recém-visitados e carrinho abandonado (sinal de intenção altíssimo), e regras de negócio (promoções, estoque). Alvo de algumas centenas de candidatos, com embeddings de item pré-computados em batch.

*Ranking* — gradient boosting ou uma rede sobre features ricas: histórico do usuário, atributos do item, afinidade usuário-categoria, contexto (hora, dispositivo, origem do tráfego), features de interação (o usuário já comprou nessa categoria? qual o preço relativo à faixa habitual dele?), e sinais de popularidade recente. Aqui cabem features em tempo real que a geração de candidatos não usa.

*Re-ranking* — diversidade (não mostrar cinco variações do mesmo produto), remoção do que já foi comprado, restrição de estoque, e boost controlado de novidade.

**Cold start** — usuário novo recebe popularidade por segmento inferido (geografia, dispositivo, origem) e migra para personalizado conforme acumula sinal; item novo entra por atributos de conteúdo e recebe exploração deliberada.

**Avaliação** — offline NDCG e recall@k, com o alerta de que métricas offline de recomendação são **notoriamente pouco correlacionadas** com resultado online por causa do viés de apresentação: você só observa feedback de itens que o sistema atual mostrou. Offline serve para descartar candidatos ruins; o A/B decide. Online: CTR e conversão como métricas de diagnóstico, retenção e valor de sessão como decisão, e guardrails de diversidade e cobertura de catálogo.

**Riscos que eu levantaria:** feedback loop concentrando exposição nos itens populares e matando a cauda longa (mitigado com exploração e monitoramento de cobertura); otimização de curto prazo degradando satisfação; e a necessidade de um holdout de longa duração para métricas estruturais.

---

### 3.2 🟡 Detecção de fraude em transações

**Clarificar:** Qual tipo de fraude? Qual o volume de transações e a taxa de fraude? **Qual o custo de um falso negativo (fraude passa) versus um falso positivo (cliente legítimo bloqueado)?** — esta é a pergunta central e a resposta molda tudo. Bloqueamos automaticamente ou enviamos para revisão? Qual a capacidade da equipe de revisão? Qual o orçamento de latência (autorização de cartão exige dezenas de milissegundos)? Qual o atraso até o rótulo (chargebacks podem levar 60–90 dias)?

**Enquadramento:** Classificação binária online, extremamente desbalanceada (tipicamente 0.1% ou menos), com **adversário ativo** — o que a torna diferente de qualquer outro problema de classificação: a distribuição muda porque alguém está deliberadamente tentando burlar você.

Uma decisão de enquadramento que vale propor: em vez de classificar fraude/não-fraude, modelar **perda esperada** — `P(fraude) × valor da transação`. Isso alinha o modelo ao objetivo real, que é minimizar dinheiro perdido, não contagem de fraudes.

**Arquitetura em camadas** — porque nem tudo precisa passar pelo modelo:

1. **Regras determinísticas** — listas de bloqueio, limites regulatórios, casos óbvios. Rápidas, auditáveis, e ajustáveis em minutos quando surge um ataque novo. **Ter regras não é falta de sofisticação, é resiliência operacional**: quando um padrão novo aparece, você bloqueia com regra hoje e retreina o modelo na semana que vem.
2. **Modelo de ML** — gradient boosting como escolha principal, por qualidade em tabular, latência de inferência baixa e interpretabilidade razoável, que importa porque decisões de bloqueio frequentemente precisam ser explicadas.
3. **Modelo de grafo / detecção de anéis** — fraude organizada compartilha dispositivos, cartões, endereços e IPs. Features de grafo (componentes conexos, número de contas por dispositivo, velocidade de propagação) capturam o que features por transação não capturam. É um diferencial forte em entrevista.
4. **Detecção de anomalia não-supervisionada** em paralelo, para cobrir padrões novos que ainda não têm rótulo — que é precisamente onde o modelo supervisionado é cego.

**Features que eu destacaria** (é aqui que a maior parte do ganho está, não no algoritmo): **velocity** — número de transações do cartão, dispositivo, IP e conta em janelas de minutos, horas e dias, que é a família de features mais preditiva neste domínio; **desvio do perfil do cliente** — valor comparado ao histórico dele, categoria incomum, geografia inconsistente; **impossibilidade física** — duas transações presenciais em cidades distantes em minutos; sinais de dispositivo e fingerprint; e features de grafo. Todas com **ponto de corte rigoroso no instante da transação**.

**Decisão e limiar** — três faixas em vez de uma: bloquear automaticamente acima de um score alto, enviar para revisão humana na faixa intermediária (dimensionada pela capacidade da equipe), e aprovar abaixo. Possivelmente com step-up authentication (2FA) na faixa média, que reduz atrito comparado a bloquear.

**Avaliação** — PR-AUC como métrica principal, precision no volume de revisão que a equipe processa, e **recall ponderado por valor**, porque pegar uma fraude de R$ 50 mil vale mais que dez de R$ 100. A métrica final é financeira: perda por fraude mais custo de falsos positivos (incluindo o custo de longo prazo de irritar um cliente legítimo, que é real e subestimado).

**Os desafios específicos que eu levantaria** — e é isso que diferencia a resposta: **adversarialidade** exige retreino frequente, monitoramento de drift agressivo, e cuidado para não expor a lógica do modelo (features facilmente manipuláveis pelo fraudador são armadilhas); **atraso de rótulo** de 60 a 90 dias significa que a métrica verdadeira é sempre defasada e é preciso operar com proxies; e **viés de seleção** — só se observa o desfecho de transações aprovadas, então o modelo nunca aprende sobre o que ele bloqueia, o que pede uma pequena fração de aprovações deliberadas na zona de bloqueio para manter a fronteira calibrada.

---

### 3.3 🔴 Sistema de busca / ranking

**Clarificar:** Busca sobre o quê — produtos, documentos, pessoas? Qual o volume do corpus e o QPS? As consultas são navegacionais (o usuário sabe o que quer) ou exploratórias? Existe sinal de clique histórico? Latência? Personalização é desejável?

**Enquadramento:** *Learning to rank*. Vale explicitar as três formulações e escolher: **pointwise** (prever relevância de cada item independentemente — simples, mas ignora que ranking é sobre ordem relativa), **pairwise** (aprender qual de dois itens é mais relevante — LambdaMART é o padrão clássico e continua muito forte), e **listwise** (otimizar a métrica de lista diretamente, como NDCG — teoricamente melhor, mais complexo). Eu começaria pairwise e justificaria.

**Arquitetura:**

*Recuperação* — **híbrida**, e esta é a recomendação central: busca léxica (BM25 sobre índice invertido) para casamento exato de termos, códigos, siglas e nomes próprios, combinada com busca densa (embeddings + ANN) para similaridade semântica, sinônimos e paráfrase. Fusão por Reciprocal Rank Fusion. Nenhuma das duas isolada é suficiente: a densa erra em códigos de produto e a léxica erra em "notebook leve para viagem".

*Ranking* — LambdaMART ou uma rede neural sobre features de três famílias: **da consulta** (comprimento, intenção inferida, categoria), **do documento** (qualidade, popularidade, frescor, disponibilidade), e **de casamento consulta-documento** (BM25 score, similaridade semântica, taxa de clique histórica daquele par). Mais features de personalização se aplicável.

*Re-ranking* — diversidade, regras de negócio, boost de estoque, e blending com anúncios se houver.

**Sinais de treino a partir de cliques** — e aqui está o problema mais interessante do domínio: cliques são **fortemente enviesados por posição** (usuários clicam mais no que está no topo, independentemente de relevância). Treinar diretamente em cliques ensina o modelo a reproduzir o ranking atual, criando um feedback loop que congela o sistema. Mitigações: modelos de clique que estimam e removem o viés de posição, randomização controlada de posições numa fração do tráfego para coletar dados não enviesados, e ponderação por propensão inversa. **Levantar isso espontaneamente é o sinal mais forte que se pode dar nessa pergunta.**

**Avaliação** — offline: NDCG e MRR sobre um conjunto com julgamentos de relevância (humanos ou derivados de cliques com correção de viés); online: CTR, taxa de abandono de busca, taxa de reformulação de consulta (sinal forte de falha), posição média do clique, e conversão.

**Casos difíceis que eu mencionaria:** consultas de cauda longa com pouco ou nenhum sinal histórico, onde o modelo precisa generalizar por conteúdo; consultas sem resultados, que degradam a experiência de forma desproporcional; e a diferença entre intenção navegacional e exploratória, que pede rankings de natureza diferente.

---

### 3.4 🔴 Assistente com RAG sobre documentação interna

**Clarificar:** Quantos documentos e de que tipo? Com que frequência mudam? Quem são os usuários e qual o custo de uma resposta errada? Há controle de acesso por documento? Latência e orçamento aceitáveis? Existe um conjunto de perguntas e respostas de referência?

**Enquadramento:** Recuperação seguida de geração ancorada. **A decisão mais importante é definir o que acontece quando o sistema não sabe** — em contexto corporativo, "não encontrei informação sobre isso" é uma resposta boa e uma alucinação confiante é um incidente.

**Pipeline offline:** ingestão e normalização dos documentos (com metadados: fonte, data, autor, permissões); **chunking**, que eu trataria como decisão de primeira ordem e não detalhe — dividir respeitando estrutura (seções, parágrafos) com sobreposição, e um padrão eficaz é indexar chunks pequenos para a busca mas recuperar a janela maior ao redor para o contexto; embedding com modelo adequado ao idioma e domínio; indexação vetorial e índice léxico em paralelo.

**Pipeline online:** processamento da consulta (reescrita, e decomposição se for uma pergunta composta); **recuperação híbrida** (densa + BM25) com **filtro de permissão aplicado na busca**, não depois — vazar conteúdo que o usuário não pode ver é o pior modo de falha; **reranking com cross-encoder** sobre os top-N, que é a intervenção de melhor custo-benefício em qualidade; montagem do prompt com instrução explícita de responder só com base nas fontes e admitir insuficiência; geração com **citações rastreáveis**; e pós-processamento verificando se as citações existem e correspondem.

**Avaliação em duas camadas** — porque sem isso não dá para melhorar nada: **recuperação** (recall@k, MRR sobre um conjunto de perguntas com o documento correto anotado) e **geração** (fidelidade ao contexto, correção, taxa de recusa apropriada). Eu construiria um conjunto de avaliação fixo de algumas dezenas a centenas de perguntas com respostas de referência, e rodaria como **teste de regressão** a cada mudança de prompt, modelo ou índice — sistemas com LLM regridem de forma silenciosa e não-óbvia.

**Riscos operacionais:** documentos desatualizados ou contraditórios (mitigar com metadados de data e preferência por versões recentes, e sinalizando conflito em vez de escolher arbitrariamente); permissões; custo por consulta (cache exato e semântico, prompt caching, roteamento por dificuldade); e **prompt injection através do conteúdo recuperado**, especialmente se o assistente tiver acesso a ferramentas com efeito colateral.

**Evolução:** começar com recuperação híbrida + reranking + um modelo bom, medir onde estão as falhas, e só então considerar fine-tuning do modelo de embedding no domínio ou do gerador para formato.

---

### 3.5 🔴 Previsão de demanda / estoque

**Clarificar:** Quantos SKUs e locais? Qual o horizonte (dia, semana, mês)? Qual a granularidade da decisão? Qual o custo de faltar estoque versus sobrar? Há promoções, sazonalidade, feriados, lançamentos? Existe histórico de quanto tempo?

**Enquadramento:** Previsão de série temporal em larga escala, com uma característica que muda tudo: **o custo dos erros é assimétrico**. Faltar estoque perde venda e cliente; sobrar custa capital e possivelmente perda do produto. Isso significa que **prever a média é a formulação errada** — o correto é prever **quantis** com perda quantílica, e escolher o quantil pelo custo relativo (nível de serviço). Levantar isso é o ponto alto da resposta.

Segunda observação de enquadramento: o histórico registra **vendas**, não **demanda**. Quando o produto esgotou, a venda foi truncada e a demanda real era maior. Treinar em vendas sem corrigir isso ensina o modelo a subestimar exatamente os produtos que mais faltam — um feedback loop que se auto-reforça. Mencionar *censored demand* é um diferencial claro.

**Abordagem:** baseline forte primeiro — sazonal ingênuo e médias móveis. Uma fração grande de projetos de forecasting não bate o baseline ingênuo, e não saber isso é constrangedor. Depois, gradient boosting com features de calendário, lags, janelas móveis, preço, promoção e estoque — que na prática é extremamente competitivo em varejo. Modelos globais (um modelo para todas as séries, com o ID da série como feature) costumam superar modelos por série, porque compartilham padrões entre SKUs e resolvem séries curtas. Modelos neurais de séries temporais quando há muitas séries e padrões complexos.

**Cuidado com árvores:** elas **não extrapolam**, então não conseguem prever crescimento continuado. Se há tendência, é preciso modelá-la explicitamente ou trabalhar com diferenças em vez de níveis.

**Validação** — walk-forward temporal com gap correspondente ao horizonte de previsão, avaliando por fold e não só na média, porque a degradação nos folds recentes é o sinal de drift que a média esconde. Métrica: WAPE ou MASE (que compara com o baseline ingênuo), evitando MAPE por causa dos zeros e da assimetria. E **avaliar no nível de agregação em que a decisão é tomada** — um erro por SKU pode se compensar no agregado, e o que importa é o nível em que o pedido é feito.

**Fechando o ciclo:** a previsão alimenta uma decisão de reposição, então a métrica final é de negócio — nível de serviço atingido, capital imobilizado, perdas. Um modelo com WAPE melhor que gera pior nível de serviço não é melhor.

---

## 4. Perguntas de calibração (o entrevistador testando você)

**"Por que não usar deep learning aqui?"** — Não é uma provocação, é um teste de julgamento. Resposta forte: em dados tabulares, gradient boosting geralmente iguala ou supera com muito menos custo de tuning e operação; deep learning paga quando há estrutura composicional (imagem, texto, sequência), volume muito grande, ou necessidade de integrar modalidades diferentes num único modelo. E a pergunta que decide: o ganho justifica o custo operacional?

**"E se você tivesse 10× menos dados?"** — Modelo mais simples, regularização mais forte, transfer learning ou modelo pré-treinado em vez de treino do zero, validação cruzada repetida em vez de holdout único, e mais peso em conhecimento de domínio para features. E ser honesto sobre a incerteza: reportar intervalos, não pontos.

**"E se a latência precisasse ser 10ms?"** — Pré-computar tudo que puder em batch, simplificar o modelo (destilação, quantização, menos features), cachear agressivamente, cortar features que exigem chamadas externas, e considerar mover parte da lógica para a etapa de geração de candidatos. E questionar o requisito: 10ms para qual percentil, e o que acontece se estourar?

**"Como você sabe que o sistema está funcionando?"** — Monitoramento em camadas (ver [11](11-mlops-producao.md)) e, principalmente, a métrica de negócio com um holdout que permita medir o efeito do sistema inteiro, não só a diferença entre versões.

**"O que você faria diferente se pudesse recomeçar?"** — Teste de reflexão. Respostas fortes: investir mais cedo em qualidade e definição de rótulos, montar o conjunto de avaliação antes do modelo, e resistir mais tempo à complexidade.

---

## 5. Armadilhas comuns

**Pular para o modelo nos primeiros 30 segundos.** É o erro que mais reprova. Os primeiros 10 minutos são de clarificação e enquadramento.

**Não fazer perguntas.** A pergunta é subespecificada de propósito; a qualidade das suas perguntas é metade da avaliação.

**Não definir a métrica de negócio.** Sem ela, nenhuma decisão técnica tem critério.

**Não discutir o rótulo.** Qual é o rótulo, de onde vem, quando chega, e quanto ele diverge do objetivo real — é a discussão mais importante do system design.

**Propor a solução mais complexa direto.** Ninguém é reprovado por propor um baseline.

**Ignorar latência, custo e complexidade operacional.** Um modelo que não cabe no orçamento não é uma solução.

**Esquecer cold start.** Está presente em quase todo sistema com usuários e itens.

**Ignorar feedback loops.** Especialmente em recomendação, busca e crédito, onde o sistema molda os próprios dados de treino.

**Não falar de monitoramento e retreino.** Sinaliza que você nunca operou um sistema.

**Assumir que rótulos existem e chegam na hora.** Atraso de rótulo muda a arquitetura inteira.

**Ignorar viés de seleção nos dados de treino.** Você só observa desfechos das decisões que tomou.

**Não segmentar a avaliação.** A métrica agregada esconde falhas concentradas onde mais importa.

**Falar só de modelagem numa pergunta de sistema.** Ingestão, features, serving, monitoramento e feedback são o sistema; o modelo é uma caixa dentro dele.

**Não terminar com riscos e evolução.** Fechar com "o que pode dar errado e qual seria a v2" muda a impressão final.
