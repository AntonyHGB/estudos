# 08 — Deep Learning Moderno

> Transformers e atenção, embeddings, transfer learning, fine-tuning, LLMs e RAG (conceitual).
> Para vagas de ML engineer, NLP ou LLM em 2026, este é o centro da entrevista. O erro típico é decorar taxonomia de modelos em vez de entender mecanismos — entrevistadores testam mecanismo.

---

## 1. Resumo conceitual

### 1.1 Atenção — o mecanismo

**O problema que ela resolve:** numa RNN, para relacionar a posição 1 com a 500, o sinal atravessa 500 passos e degrada. Atenção permite que qualquer posição consulte diretamente qualquer outra, em um único passo.

**A formulação:**

```
Attention(Q, K, V) = softmax( QKᵀ / √d_k ) V
```

A analogia de **recuperação de informação** é a melhor forma de explicar:

- **Query (Q)** — o que esta posição está procurando.
- **Key (K)** — o que cada posição oferece como "rótulo indexável".
- **Value (V)** — o conteúdo que cada posição entrega se for selecionada.

`QKᵀ` calcula a compatibilidade entre cada query e cada key por produto interno. O softmax transforma isso em pesos que somam 1 — uma média ponderada suave sobre todas as posições. Multiplicar por `V` produz a saída: uma mistura dos conteúdos, ponderada pela relevância. É uma **busca em dicionário diferenciável e suave**, em que em vez de recuperar uma entrada você recupera uma combinação convexa de todas.

**Por que dividir por `√d_k` — a pergunta favorita.** Se os componentes de q e k são aproximadamente independentes com média 0 e variância 1, o produto interno de dois vetores de dimensão `d_k` tem variância `d_k`, portanto desvio-padrão `√d_k`. Com `d_k = 64`, os scores variam numa faixa de ordem 8; com `d_k` maior, ainda mais. Scores grandes empurram o softmax para uma distribuição quase one-hot, e nessa região **o gradiente do softmax é praticamente zero** — o treino estagna. Dividir por `√d_k` normaliza a variância dos scores para ~1, mantendo o softmax numa região com gradiente saudável. Note que é um argumento **sobre gradientes**, não sobre "estabilidade numérica" genérica.

**Self-attention vs cross-attention:** em self-attention, Q, K e V vêm da mesma sequência (cada posição olha as outras do mesmo texto). Em cross-attention, Q vem de uma sequência e K/V de outra — é o mecanismo que conecta o decoder ao encoder em tradução, e o que conecta texto e imagem em modelos multimodais.

**Multi-head attention:** em vez de uma atenção com dimensão `d`, usam-se `h` cabeças com dimensão `d/h` cada, em paralelo, e concatenam-se as saídas. A razão: uma única atenção produz **uma** distribuição de pesos, forçando uma média que mistura tudo. Múltiplas cabeças permitem que diferentes subespaços capturem diferentes tipos de relação simultaneamente (uma cabeça pode acompanhar concordância sintática, outra correferência). O custo total é aproximadamente o mesmo, porque as dimensões são divididas.

**Máscara causal:** em modelos autoregressivos, a posição `t` não pode ver posições futuras. Implementa-se somando `-∞` aos scores das posições proibidas antes do softmax, o que zera os pesos correspondentes. É isso que permite treinar em paralelo sobre a sequência inteira e ainda assim ter um modelo que gera token a token.

**Complexidade:** `O(n²·d)` em tempo e `O(n²)` em memória para a matriz de atenção, onde `n` é o comprimento da sequência. **É o gargalo central de contexto longo.** Mitigações: atenção esparsa/local, aproximações lineares, e — o que de fato se usa em produção — **FlashAttention**, que não muda a complexidade assintótica mas reorganiza o cálculo em blocos que cabem na memória rápida da GPU, evitando materializar a matriz `n×n` inteira. Ganho grande de memória e velocidade sem aproximação.

### 1.2 A arquitetura Transformer

Um bloco típico (na variante pre-norm, que é o padrão moderno):

```
x = x + Attention(Norm(x))
x = x + FFN(Norm(x))
```

**Componentes e o porquê de cada um:**

- **Conexões residuais** em torno de cada sub-camada — permitem o gradiente fluir por dezenas ou centenas de blocos.
- **Normalização** (LayerNorm, ou RMSNorm nos modelos modernos) — estabiliza. Aplicada **antes** do bloco (pre-norm), o que é notavelmente mais estável em grande profundidade que o post-norm do artigo original, que exigia warmup cuidadoso para não divergir.
- **Feed-forward por posição** — duas camadas densas aplicadas independentemente a cada posição, com dimensão interna tipicamente 4× a do modelo. É onde está a maior parte dos parâmetros. Nos LLMs modernos usa-se **SwiGLU** em vez de ReLU/GELU simples.
- **Codificação posicional** — atenção é **permutação-equivariante**: sem informação de posição, ela vê a sequência como um conjunto e "o cachorro mordeu o homem" seria idêntico a "o homem mordeu o cachorro". Isso é essencial e cai com frequência.

**Codificação posicional, evolução:** o artigo original usou senoides fixas; depois vieram embeddings posicionais aprendidos; o padrão em 2026 é **RoPE (Rotary Position Embedding)**, que codifica posição **rotacionando** os vetores de query e key por um ângulo proporcional à posição. A propriedade elegante: o produto interno entre duas posições depende apenas da **diferença** entre elas, o que dá uma noção de posição relativa naturalmente e se estende melhor a sequências mais longas do que o modelo viu no treino (especialmente com técnicas de interpolação/escala da base). Alternativa também usada: ALiBi, que aplica um viés linear proporcional à distância.

**Três famílias:**

- **Encoder-only** (BERT) — atenção bidirecional, pré-treinado com masked language modeling. Bom para **compreensão**: classificação, NER, embeddings de sentença. Não gera texto naturalmente.
- **Decoder-only** (famílias GPT e Llama, entre outras) — atenção causal, pré-treinado prevendo o próximo token. **É a arquitetura dominante entre LLMs generativos generalistas em 2026**, porque a mesma formulação serve para geração e — via prompting — para muitas tarefas. Encoder-only e encoder-decoder continuam relevantes quando a tarefa favorece compreensão ou uma transformação seq2seq bem definida.
- **Encoder-decoder** (T5, modelos de tradução) — o encoder codifica a entrada, o decoder gera atendendo ao encoder por cross-attention. Natural para seq2seq com entrada e saída bem distintas.

**O que define um LLM moderno em 2026** (útil para mostrar atualidade): decoder-only com **RoPE**, **RMSNorm** em pre-norm, **SwiGLU** na camada feed-forward, **Grouped-Query Attention** (GQA) e, cada vez mais, **Mixture-of-Experts**.

**GQA** merece explicação porque é uma pergunta boa: em multi-head attention padrão, cada cabeça tem suas próprias keys e values, e durante a geração todos precisam ser mantidos no **KV cache** — cujo tamanho cresce com o comprimento do contexto e domina a memória de inferência. GQA mantém muitas cabeças de query mas **compartilha um número menor de cabeças de key/value entre grupos**, reduzindo o KV cache proporcionalmente com perda mínima de qualidade. É otimização de **inferência**, não de treino, e saber essa distinção é o que impressiona.

**MoE** (Mixture-of-Experts): substitui a camada feed-forward densa por muitos "experts", ativando apenas alguns por token via uma rede de roteamento. Resultado: **muito mais parâmetros (capacidade) por unidade de FLOPs de inferência**. O custo é complexidade de treino (balanceamento de carga entre experts) e de memória (todos os parâmetros precisam estar disponíveis, mesmo que poucos sejam usados por token).

### 1.3 Embeddings

**A ideia:** representar objetos discretos (palavras, usuários, produtos, imagens) como vetores densos num espaço onde **proximidade geométrica corresponde a similaridade semântica**. Contraste com one-hot, onde todos os itens são igualmente distantes entre si e a dimensão é o tamanho do vocabulário.

**Evolução conceitual:**

- **Word2Vec / GloVe** — embeddings **estáticos**: uma palavra tem um vetor, independentemente do contexto. Aprendidos pela hipótese distribucional ("uma palavra é caracterizada pela companhia que mantém"). Limitação decisiva: "banco" de sentar e "banco" financeiro têm o mesmo vetor.
- **Embeddings contextuais** (BERT em diante) — o vetor de um token depende da frase inteira. Resolve polissemia.
- **Embeddings de sentença/documento** — modelos treinados especificamente para que a similaridade entre vetores de textos inteiros seja significativa, tipicamente com **aprendizado contrastivo** (aproximar pares relacionados, afastar não relacionados). Este é o tipo usado em busca semântica e RAG.

**Ponto que cai muito:** os embeddings de um LLM generativo **não são automaticamente bons embeddings de recuperação**. Modelos causais são treinados para prever o próximo token, não para que a média dos estados ocultos seja um bom resumo semântico. Modelos de embedding dedicados são treinados com objetivo contrastivo e superam consistentemente esse uso improvisado.

**Similaridade:** **cosseno** é o padrão, porque mede ângulo e ignora magnitude — o que é desejável, já que a magnitude frequentemente reflete frequência ou comprimento, não semântica. Se os vetores estão normalizados a norma 1, cosseno e produto interno são equivalentes, e a ordenação por distância euclidiana é a mesma. Vale saber isso porque bancos vetoriais oferecem as três métricas e a escolha precisa ser consistente com o treino do modelo.

**Embeddings de entidades em sistemas de produção** (usuários, itens): aprendidos por fatoração de matrizes ou como camada de embedding numa rede. Capturam similaridade comportamental e são a base de recomendação moderna, além de resolverem o problema de alta cardinalidade categórica.

### 1.4 Transfer learning e fine-tuning

**Premissa:** representações aprendidas numa tarefa com muitos dados transferem para tarefas relacionadas com poucos dados. É o que tornou deep learning viável fora de laboratórios com datasets gigantes.

**Estratégias, em ordem de custo:**

1. **Feature extraction** — congelar o modelo pré-treinado, usá-lo como extrator de embeddings, treinar só um classificador leve por cima. Barato, rápido, e uma boa primeira opção quando há **muito poucos dados** (centenas de exemplos). Congelar o backbone reduz drasticamente a capacidade treinável, mas a cabeça ainda pode overfittar e precisa de validação e regularização.
2. **Fine-tuning completo** — atualizar todos os pesos, com learning rate **muito menor** que o de treino do zero (tipicamente 10 a 100× menor), para não destruir as representações aprendidas. Precisa de mais dados e mais computação.
3. **Fine-tuning parcial** — congelar as primeiras camadas (features gerais: bordas, sintaxe) e treinar as últimas (features específicas da tarefa). Compromisso razoável.
4. **PEFT (Parameter-Efficient Fine-Tuning)** — o padrão para LLMs.

**LoRA** é o método PEFT que você precisa saber explicar. A ideia: em vez de atualizar a matriz `W` (que pode ter centenas de milhões de parâmetros), aprender uma **atualização de baixo posto** `ΔW = BA`, onde `B` é `d×r` e `A` é `r×k` com `r` pequeno (4 a 64). Treina-se apenas `A` e `B`; `W` fica congelada. Resultado: uma fração minúscula dos parâmetros treináveis, muito menos memória de otimizador, e adaptadores pequenos que podem ser trocados por tarefa e **mesclados de volta em `W` na inferência**, sem custo adicional de latência. A justificativa: a atualização necessária para adaptar a uma tarefa específica tende a ter **posto intrínseco baixo**. **QLoRA** combina LoRA com quantização do modelo base (4 bits), permitindo fine-tuning de modelos grandes em uma única GPU.

**Catastrophic forgetting:** ao ajustar para uma nova tarefa, o modelo pode perder capacidade nas anteriores. Mitigações: learning rate baixo, congelamento parcial, misturar dados das tarefas antigas no treino, ou métodos PEFT — que, ao manter os pesos base intactos, mitigam o problema estruturalmente.

**Quando fine-tuning é a escolha errada:** quando o que falta é **conhecimento factual atualizável** (aí é RAG), quando há pouquíssimos exemplos (few-shot prompting resolve mais barato), e quando o requisito muda com frequência (fine-tuning cria um artefato estático que precisa ser refeito).

### 1.5 LLMs — conceitos que caem

**Pré-treinamento:** prever o próximo token em corpus massivo. Objetivo auto-supervisionado, o que remove o gargalo de rotulagem. É onde a maior parte da capacidade é adquirida.

**Pós-treinamento / alinhamento:** tipicamente **SFT** (fine-tuning supervisionado em exemplos de instrução-resposta), seguido de otimização por preferências — **RLHF** (treinar um modelo de recompensa a partir de comparações humanas e otimizar a política com PPO, com penalidade KL contra o modelo de referência) ou **DPO** (otimiza diretamente sobre os pares de preferência, sem treinar um modelo de recompensa separado nem rodar RL, o que é bem mais simples e estável). O risco central desta etapa é **reward hacking**: otimizar excessivamente contra um proxy imperfeito degrada a qualidade real.

**Tokenização:** modelos operam sobre subpalavras (BPE, WordPiece, SentencePiece), não caracteres nem palavras. Consequências práticas que aparecem em entrevista: explica por que LLMs erram em contar letras ou manipular caracteres (eles não veem letras), por que idiomas sub-representados no tokenizador consomem mais tokens e portanto custam mais, e por que números são tratados de forma inconsistente.

**Contexto e KV cache:** durante a geração, recomputar a atenção sobre todo o prefixo a cada token seria quadrático. O KV cache guarda as keys e values já computadas, tornando cada novo token linear no comprimento. O custo é **memória**, que cresce linearmente com o contexto e com o número de camadas — e é o principal limitador de throughput em serving. É o que GQA, MQA e atenção multi-latente atacam.

**Decodificação:** *greedy* (sempre o token mais provável — determinístico e repetitivo), *beam search* (mantém k hipóteses — bom para tradução, ruim para texto aberto porque produz saídas insossas), *sampling* com **temperatura** (T<1 concentra a distribuição e torna o texto mais conservador; T>1 achata e torna mais diverso e mais errático), **top-k** e **top-p / nucleus** (restringem o conjunto de candidatos antes de amostrar, cortando a cauda de tokens absurdos).

**Alucinação:** o modelo é otimizado para produzir continuações **plausíveis**, não verdadeiras. Não existe, no objetivo de treino, um termo que penalize falsidade especificamente. Mitigações: RAG (ancorar em fontes recuperadas), pedir citações verificáveis, decodificação mais conservadora, verificação por ferramentas externas, e — a mais robusta em produção — desenhar o sistema para que respostas sem fonte sejam recusadas.

**Escala:** as leis de escala descrevem como a perda cai previsivelmente com parâmetros, dados e computação. A lição prática mais duradoura é que modelos anteriores eram **subtreinados em dados** para seu tamanho: para um orçamento fixo de computação, existe uma proporção mais eficiente entre tamanho do modelo e volume de tokens. Isso mudou a prática de "modelos cada vez maiores" para "modelos bem dimensionados treinados em muito mais dados", com foco crescente em custo de inferência.

### 1.6 RAG (Retrieval-Augmented Generation)

**O problema:** o conhecimento de um LLM está congelado nos pesos, é caro de atualizar, não é atribuível a fontes, e não cobre dados privados.

**A solução:** recuperar documentos relevantes em tempo de consulta e incluí-los no prompt como contexto.

**O pipeline, e cada etapa é uma pergunta potencial:**

**Indexação (offline):**

1. **Chunking** — dividir documentos em pedaços. **É a decisão mais subestimada do pipeline.** Chunks pequenos são precisos mas perdem contexto; grandes trazem contexto mas diluem o sinal do embedding e consomem janela. Estratégias: tamanho fixo com sobreposição, divisão por estrutura (seções, parágrafos), ou chunking semântico. Um padrão útil é indexar chunks pequenos para a busca mas recuperar a janela maior ao redor para o contexto.
2. **Embedding** — transformar cada chunk num vetor com um modelo de embedding dedicado.
3. **Indexação vetorial** — armazenar num índice ANN (HNSW, IVF-PQ). Isso é kNN aproximado, com o trade-off explícito entre recall da busca e latência.

**Consulta (online):**

4. **Processamento da query** — reescrita, expansão, ou decomposição em subperguntas. Importa porque a pergunta do usuário raramente é formulada como o documento que a responde.
5. **Recuperação** — busca vetorial e/ou léxica.
6. **Reranking** — reordenar os top-N candidatos com um modelo mais caro e preciso (tipicamente um **cross-encoder**, que processa query e documento juntos e portanto captura interações que embeddings independentes não capturam). Esta é a etapa com **melhor relação custo-benefício** para melhorar qualidade, e citá-la é um sinal claro de experiência prática.
7. **Geração** — montar o prompt com o contexto e instruções, incluindo instrução explícita para responder apenas com base nas fontes e admitir quando não sabe.

**Busca híbrida** — combinar busca densa (embeddings, boa para similaridade semântica e paráfrase) com busca esparsa (BM25, boa para termos exatos, códigos de produto, nomes próprios, siglas). Fundir com Reciprocal Rank Fusion. **Quase sempre supera qualquer uma isolada**, e é a resposta esperada para "como você melhoraria a recuperação?".

**RAG vs fine-tuning — a pergunta clássica:**

| | RAG | Fine-tuning |
|---|---|---|
| Melhor para | Conhecimento factual, dados que mudam, dados privados | Formato, estilo, tom, comportamento, tarefas específicas |
| Atualização | Reindexar (barato, imediato) | Retreinar (caro, lento) |
| Atribuição | Natural (você tem as fontes) | Impossível |
| Custo de inferência | Maior (contexto longo + busca) | Igual ao base |
| Alucinação | Reduz (mas não elimina) | Não reduz |

Regra: **RAG para o que o modelo precisa saber; fine-tuning para como ele deve se comportar.** E não são excludentes — a combinação é comum.

**Onde RAG falha, na prática:**

- **Recuperação ruim** — se o documento certo não é recuperado, nenhuma qualidade de LLM salva. **A maioria das falhas de RAG é falha de recuperação, não de geração**, e dizer isso é a resposta que separa quem construiu de quem leu sobre.
- **Chunking inadequado** — a informação está partida entre chunks e nenhum sozinho responde.
- **Contexto contraditório** — documentos conflitantes, e o modelo escolhe arbitrariamente.
- **Perda no meio (lost in the middle)** — com contexto longo, informação no meio do prompt tende a ser menos utilizada que a do início e do fim. Argumento a favor de recuperar poucos chunks bons em vez de muitos medianos.
- **O modelo ignora o contexto** e responde pelo conhecimento paramétrico, inclusive contradizendo a fonte.

**Avaliação de RAG** — precisa ser em duas camadas, e responder isso bem é diferencial: **recuperação** (recall@k, MRR, NDCG — o documento certo está entre os recuperados?) e **geração** (fidelidade ao contexto/*groundedness*, relevância da resposta, correção factual). Frameworks de avaliação com LLM como juiz são comuns, mas exigem validação contra julgamento humano num conjunto de referência, senão você está confiando num avaliador não calibrado.

### 1.7 Agentes e uso de ferramentas (contexto de 2026)

Vale conhecer conceitualmente, porque aparece cada vez mais: LLMs que decidem chamar funções externas (busca, código, APIs), observam o resultado e iteram. Padrões: *tool calling* estruturado, laços de raciocínio-ação, e memória entre passos. Os problemas práticos que valem citar: **acúmulo de erro** ao longo de trajetórias longas, **custo e latência** de múltiplas chamadas, **avaliação difícil** (o resultado depende de uma trajetória inteira, não de uma saída), e **segurança** — prompt injection através de conteúdo recuperado ou de saídas de ferramentas é um risco real quando o agente tem permissões de escrita.

---

## 2. Perguntas de entrevista

---

**🟢 O que é um embedding?**

**Resposta modelo:** É a representação de um objeto discreto — palavra, usuário, produto — como um vetor denso de dimensão relativamente baixa, aprendido de forma que **proximidade geométrica corresponda a similaridade semântica ou comportamental**. É o contraste com one-hot, onde a dimensão é o tamanho do vocabulário e todos os itens são igualmente distantes entre si, sem nenhuma noção de que "cachorro" está mais perto de "gato" do que de "guarda-chuva".

Embeddings estáticos como Word2Vec dão um vetor por palavra independentemente do contexto, o que falha com polissemia. Embeddings contextuais, de modelos tipo BERT em diante, produzem um vetor que depende da frase inteira. E para busca e RAG usa-se um terceiro tipo: modelos de embedding de sentença treinados com objetivo contrastivo, para que a similaridade entre textos inteiros seja significativa.

**Follow-up:** *"Qual métrica de similaridade?"* — Cosseno é o padrão, porque mede ângulo e ignora magnitude, que costuma refletir frequência ou comprimento e não semântica. Se os vetores estão normalizados, cosseno e produto interno são equivalentes e a ordenação por distância euclidiana coincide. O importante é usar a métrica consistente com a que o modelo foi treinado.

---

**🟢 O que transfer learning e por que funciona?**

**Resposta modelo:** É reutilizar um modelo treinado numa tarefa com muitos dados como ponto de partida para outra tarefa com poucos dados. Funciona porque as representações de baixo e médio nível são amplamente compartilhadas entre tarefas do mesmo domínio: bordas e texturas servem para qualquer tarefa de visão, e estrutura sintática e semântica geral servem para qualquer tarefa de linguagem. O que é específico da tarefa costuma estar nas camadas finais.

Na prática eu escolheria a estratégia pelo volume e pela distância entre os domínios: com centenas de exemplos, começo congelando o modelo e treino só uma cabeça leve, o que reduz a capacidade treinável — ainda validando o overfitting dessa cabeça; com mais dados, considero fine-tuning das últimas camadas ou completo, com learning rate muito menor que o de treino do zero para não destruir o que foi aprendido; e para LLMs, métodos PEFT como LoRA treinam uma fração minúscula dos parâmetros.

---

**🟡 Explique o mecanismo de atenção.**

**Resposta modelo:** É uma busca em dicionário diferenciável. Cada posição gera três vetores: uma **query**, que representa o que ela está procurando; uma **key**, que representa o que ela oferece; e um **value**, que é o conteúdo que ela entrega se for selecionada.

O produto interno entre a query de uma posição e as keys de todas as outras mede compatibilidade. O softmax transforma essas compatibilidades em pesos que somam 1, e a saída é a média ponderada dos values. Ou seja, em vez de recuperar uma entrada de um dicionário, você recupera uma combinação convexa de todas, ponderada por relevância — e isso é diferenciável, então dá para aprender.

Isso resolve o problema estrutural das RNNs: qualquer par de posições fica a distância 1, em vez de precisar atravessar centenas de passos recorrentes. E como não há dependência sequencial, o treino paraleliza sobre a sequência inteira.

**Follow-up quase garantido:** *"Por que dividir por raiz de d_k?"* — Se os componentes de q e k são aproximadamente independentes com variância 1, o produto interno de vetores de dimensão `d_k` tem variância `d_k`, então desvio-padrão `√d_k`. Scores grandes empurram o softmax para uma distribuição quase one-hot, e nessa região **o gradiente do softmax é praticamente zero**, o que faz o treino estagnar. Dividir por `√d_k` normaliza a variância dos scores e mantém o softmax numa faixa com gradiente saudável. É um argumento sobre gradiente, não sobre overflow numérico.

**Follow-up:** *"Por que múltiplas cabeças?"* — Uma única atenção produz uma distribuição de pesos, forçando o modelo a fazer uma média que mistura tipos diferentes de relação. Múltiplas cabeças operam em subespaços diferentes e podem capturar relações distintas em paralelo — uma acompanhando dependência sintática, outra correferência. O custo total é praticamente o mesmo, porque a dimensão é dividida entre as cabeças.

**Follow-up 🔴:** *"Qual a complexidade e como se lida com contexto longo?"* — Quadrática no comprimento da sequência, tanto em tempo quanto na memória da matriz de atenção. É o gargalo central de contexto longo. As abordagens são atenção esparsa ou local, aproximações lineares, e — a que de fato se usa em produção — FlashAttention, que não muda a complexidade assintótica mas reorganiza o cálculo em blocos que cabem na memória rápida da GPU, evitando materializar a matriz inteira. Ganho grande de memória e velocidade, sem aproximar nada.

---

**🟡 Por que transformers precisam de codificação posicional?**

**Resposta modelo:** Porque a atenção é permutação-equivariante: ela calcula compatibilidades entre pares de vetores sem nenhuma noção de ordem. Sem informação posicional, o modelo veria a sequência como um conjunto, e "o cachorro mordeu o homem" seria idêntico a "o homem mordeu o cachorro".

O artigo original usava senoides fixas de frequências diferentes; depois vieram embeddings posicionais aprendidos. O padrão em 2026 é **RoPE**, que codifica a posição rotacionando os vetores de query e key por um ângulo proporcional à posição. A propriedade elegante é que o produto interno entre duas posições passa a depender apenas da **diferença** entre elas, o que dá posição relativa naturalmente e se estende melhor a contextos mais longos do que o modelo viu no treino, especialmente com técnicas de escala da base. ALiBi é a alternativa também usada, aplicando um viés linear proporcional à distância.

---

**🟡 RAG ou fine-tuning?**

**Resposta modelo:** Resolvem problemas diferentes, e a regra que eu uso é: **RAG para o que o modelo precisa saber; fine-tuning para como ele deve se comportar.**

RAG quando o problema é conhecimento — fatos específicos, dados privados, informação que muda. Ele permite atualizar reindexando, em vez de retreinando; permite atribuição a fontes, o que é frequentemente um requisito e não um extra; e reduz alucinação ao ancorar a resposta em texto recuperado.

Fine-tuning quando o problema é comportamento — formato de saída consistente, tom, seguir um estilo específico, ou uma tarefa especializada que o modelo base não executa bem. Fine-tuning não é bom mecanismo para injetar fatos: é caro, o conhecimento fica congelado de novo, não dá atribuição, e não há garantia de que o fato foi de fato absorvido.

Não são excludentes, e a combinação é comum: fine-tuning para o modelo seguir o formato e usar as fontes corretamente, RAG para fornecer os fatos. E antes de qualquer um dos dois eu tentaria **prompting bem feito com few-shot**, porque frequentemente resolve por uma fração do custo — começar pelo mais barato é parte da resposta.

---

**🟡 Como você melhoraria um sistema de RAG que está retornando respostas ruins?**

**Resposta modelo:** Primeiro eu **diagnosticaria em qual etapa está o problema**, porque as correções são completamente diferentes. O teste: pegar as consultas ruins e verificar se o documento correto está entre os recuperados. Se não está, é falha de **recuperação**; se está e a resposta ainda é ruim, é falha de **geração**. Na minha experiência a maioria das falhas de RAG é de recuperação.

**Se é recuperação**, na ordem de custo-benefício: adicionar **reranking** com um cross-encoder sobre os top-N candidatos, que é a intervenção com melhor retorno porque o cross-encoder processa query e documento juntos e captura interações que embeddings independentes não capturam; adotar **busca híbrida**, combinando densa com BM25, porque a densa erra em termos exatos, siglas e códigos de produto e a léxica cobre exatamente isso; revisar o **chunking**, que é a decisão mais subestimada — chunks grandes demais diluem o embedding, pequenos demais perdem contexto, e uma tática eficaz é indexar chunks pequenos mas recuperar a janela ao redor; e trocar o **modelo de embedding** por um treinado para recuperação no idioma e domínio certos, ou reescrever a query, porque a pergunta do usuário raramente é formulada como o documento que a responde.

**Se é geração**, o modelo tem o contexto certo e ainda erra: eu reforçaria a instrução para responder apenas com base nas fontes e admitir quando não há informação suficiente; reduziria o número de chunks, porque contexto longo demais dilui e existe o efeito de a informação no meio do prompt ser menos utilizada; pediria **citação explícita** de trechos, o que tanto melhora a fidelidade quanto torna o erro auditável; e reduziria a temperatura.

E eu montaria uma **avaliação em duas camadas** — métricas de recuperação como recall@k e MRR, e métricas de geração como fidelidade ao contexto e correção — sobre um conjunto fixo de perguntas com respostas de referência. Sem isso, toda melhoria é impressão.

---

**🟡 O que é LoRA e por que ele é usado?**

**Resposta modelo:** LoRA é fine-tuning eficiente em parâmetros. Em vez de atualizar a matriz de pesos inteira, ele aprende uma **atualização de baixo posto**: `ΔW = BA`, onde `B` e `A` são matrizes finas com posto `r` pequeno, tipicamente entre 4 e 64. Os pesos originais ficam congelados e só `A` e `B` são treinados.

Os ganhos: uma fração minúscula de parâmetros treináveis, o que reduz drasticamente a memória do otimizador — que é o que normalmente domina o consumo em fine-tuning; adaptadores pequenos que podem ser armazenados e trocados por tarefa, servindo muitas variantes a partir de um único modelo base; e, na inferência, o adaptador pode ser **mesclado de volta** na matriz original, então **não há custo adicional de latência**.

A justificativa conceitual é que a atualização necessária para adaptar um modelo a uma tarefa específica tende a ter posto intrínseco baixo — a adaptação vive num subespaço pequeno. QLoRA combina isso com quantização do modelo base em 4 bits, o que viabiliza fine-tuning de modelos grandes numa única GPU.

**Follow-up:** *"Quando fine-tuning completo é melhor?"* — Quando a adaptação exige mudança substancial de capacidade, não só de estilo — por exemplo um domínio muito distante do pré-treinamento, ou um idioma pouco representado. E quando há dados abundantes e computação disponível. Para a maioria dos casos práticos de adaptação de comportamento, LoRA atinge qualidade comparável por uma fração do custo.

---

**🔴 Por que LLMs alucinam e como você mitiga?**

**Resposta modelo:** Porque o objetivo de treino é produzir continuações **plausíveis** dada a distribuição do corpus, não continuações **verdadeiras**. Não existe, na função de perda, um termo que penalize falsidade especificamente — uma frase falsa e fluente tem perda baixa se for estatisticamente típica. Some-se a isso que o modelo não tem um mecanismo interno de verificação, não tem acesso a fontes, e o pós-treinamento por preferências pode inclusive **piorar** o problema, porque respostas confiantes e completas costumam ser preferidas por avaliadores humanos em relação a "não sei" — o que ensina o modelo a preencher lacunas com confiança.

Mitigações, em camadas. **Ancorar em fontes com RAG** é a mais efetiva para conhecimento factual, junto com instrução explícita para responder só com base no contexto e admitir insuficiência. **Exigir citações verificáveis**, o que torna a alucinação detectável em vez de invisível. **Verificação externa** por ferramentas — executar o código, consultar a API, checar o cálculo. **Decodificação mais conservadora**, temperatura baixa para tarefas factuais. **Estimativa de confiança**, usando consistência entre múltiplas amostragens como sinal — respostas que variam entre amostras são menos confiáveis.

E o ponto de desenho de sistema: **a mitigação mais robusta é arquitetural, não do modelo**. Desenhar o produto para que a resposta sem fonte seja recusada, para que o usuário veja o trecho de origem, e para que ações consequentes exijam confirmação. Você não elimina alucinação no modelo; você constrói um sistema em que ela é detectada e contida.

---

**🔴 Como você avaliaria um sistema baseado em LLM?**

**Resposta modelo:** Em camadas, porque não existe uma métrica única, e o erro comum é ficar só na camada de baixo.

**Camada 1 — componentes com verdade objetiva.** Se há recuperação, avaliar recuperação separadamente com recall@k, MRR, NDCG. Se há chamada de ferramenta, avaliar se a ferramenta certa foi chamada com os argumentos certos. Essas partes têm resposta certa e devem ser medidas isoladamente, porque falhas aqui são as mais fáceis de corrigir e as mais fáceis de confundir com falha do modelo.

**Camada 2 — tarefas com resposta verificável.** Onde existe saída checável — código que roda, JSON que valida contra schema, resposta numérica, classificação — construir um conjunto de teste e medir exatamente. É a camada mais confiável e a que eu maximizaria.

**Camada 3 — qualidade aberta.** Aqui uso um LLM como juiz com rubrica explícita e critérios separados (fidelidade ao contexto, relevância, completude, formato). Com duas ressalvas obrigatórias: o juiz precisa ser **validado contra julgamento humano** num subconjunto, medindo concordância, senão você está confiando num avaliador não calibrado; e ele tem vieses conhecidos, como preferir respostas longas e preferir a primeira opção apresentada, o que se mitiga alternando a ordem e controlando comprimento.

**Camada 4 — avaliação humana** em amostra, com rubrica e múltiplos avaliadores, medindo concordância entre eles. Cara, mas é a âncora de verdade das camadas acima.

**Camada 5 — online.** A/B test com métricas de produto: taxa de resolução, retomadas de conversa, escalonamento para humano, satisfação, e custo por interação. É o que de fato decide.

Eu adicionaria duas coisas que costumam faltar: **testes de regressão** com um conjunto fixo de casos que rodam a cada mudança de prompt ou modelo, porque sistemas com LLM regridem de forma silenciosa e não-óbvia; e **avaliação adversarial** — prompt injection, casos de borda, entradas fora de domínio — especialmente se o sistema tem acesso a ferramentas com efeitos colaterais.

---

**🔴 Explique a diferença entre modelos encoder-only, decoder-only e encoder-decoder. Por que decoder-only dominou?**

**Resposta modelo:** **Encoder-only**, como BERT, usa atenção bidirecional — cada token vê todo o contexto dos dois lados — e é pré-treinado prevendo tokens mascarados. Isso dá representações muito boas para **compreensão**: classificação, NER, embeddings. Não gera texto naturalmente, porque o objetivo de treino não é autoregressivo.

**Decoder-only** usa atenção causal, cada token vê apenas os anteriores, e é pré-treinado prevendo o próximo token.

**Encoder-decoder** codifica a entrada bidirecionalmente e gera a saída atendendo ao encoder via cross-attention. É natural quando entrada e saída são objetos claramente distintos, como em tradução.

Decoder-only dominou por várias razões que se somam. **O objetivo de treino é o mais simples e mais eficiente em dados**: cada token do corpus fornece um sinal de treino, enquanto no masked language modeling só os tokens mascarados (tipicamente 15%) contribuem. **A mesma formulação serve para tudo** — com prompting, classificação, extração e geração viram todas continuação de texto, o que elimina a necessidade de arquiteturas por tarefa. **A arquitetura é mais simples**, sem cross-attention e sem dois conjuntos de parâmetros, o que facilita escalar. E **a inferência incremental com KV cache é natural**, o que importa muito em serving.

A nuance honesta: encoder-only continua sendo a escolha certa para embeddings e classificação de alto volume, porque é muito menor e mais barato para essas tarefas específicas. Usar um LLM generativo para classificar sentimento em milhões de documentos é desperdiçar duas ordens de grandeza de custo.

---

**🔴 Um LLM em produção está lento e caro. O que você faz?**

**Resposta modelo:** Eu atacaria em quatro frentes, medindo primeiro onde está o custo — tokens de entrada, tokens de saída, ou número de chamadas.

**Reduzir tokens.** Prompts costumam crescer sem controle. Comprimir instruções, remover few-shot examples redundantes, e — no caso de RAG — recuperar menos chunks e melhores, o que reduz custo e frequentemente **melhora** qualidade pelo efeito de diluição em contexto longo. Limitar o comprimento máximo da saída.

**Reduzir chamadas.** **Cache** é o maior ganho isolado: cache exato para consultas repetidas, cache semântico para consultas parecidas, e **prompt caching** para prefixos fixos, que a maioria dos provedores oferece e que reduz muito o custo de instruções longas repetidas.

**Reduzir o tamanho do modelo.** Roteamento por dificuldade — um modelo pequeno atende a maioria dos casos e escala para o grande apenas quando necessário, com um classificador ou heurística decidindo. **Destilação** — treinar um modelo menor com saídas do maior na sua distribuição real de consultas, o que frequentemente atinge qualidade próxima numa tarefa restrita por uma fração do custo. **Quantização** para 8 ou 4 bits, se você mesmo serve o modelo.

**Otimizar o serving**, se for infraestrutura própria: continuous batching, PagedAttention para gerenciar o KV cache com menos fragmentação, GQA ou MQA para reduzir o tamanho do cache, e speculative decoding, que usa um modelo pequeno para propor tokens e o grande apenas para verificar — o que acelera sem alterar a distribuição de saída.

Sobre latência percebida: **streaming** muda a experiência mais que qualquer otimização, porque o tempo até o primeiro token importa mais que o tempo total para o usuário.

E eu estabeleceria antes o que estou disposto a perder: cada uma dessas medidas tem um custo em qualidade, então preciso de um conjunto de avaliação fixo para medir a degradação e decidir conscientemente, em vez de descobrir por reclamação de usuário.

---

## 3. Armadilhas comuns

**Explicar atenção sem explicar Q, K e V como papéis distintos.** Recitar a fórmula sem a intuição de recuperação não convence.

**Dizer que o `√d_k` é "para estabilidade numérica".** É sobre a variância dos scores e a saturação do gradiente do softmax.

**Esquecer que atenção não tem noção de ordem.** Codificação posicional é essencial, não um detalhe.

**Achar que transformers eliminaram o problema de contexto longo.** A complexidade quadrática continua sendo o gargalo; FlashAttention melhora constantes e memória, não a assintótica.

**Confundir FlashAttention com atenção aproximada.** Ela é exata; a otimização é de acesso à memória.

**Usar os estados ocultos de um LLM generativo como embeddings de recuperação.** Modelos de embedding dedicados, treinados com objetivo contrastivo, são consistentemente melhores.

**Achar que fine-tuning é o jeito de adicionar conhecimento factual.** É caro, congela de novo, não dá atribuição e não garante absorção. RAG resolve melhor.

**Tratar RAG como solução completa para alucinação.** Reduz, não elimina — o modelo pode ignorar ou contradizer o contexto.

**Ignorar a etapa de reranking.** É frequentemente a melhoria de melhor custo-benefício em RAG.

**Não avaliar recuperação e geração separadamente.** Sem isso você não sabe o que consertar.

**Usar LLM como juiz sem validar contra humano.** É um avaliador não calibrado, com vieses conhecidos de comprimento e posição.

**Achar que contexto maior é sempre melhor.** Contexto longo dilui, custa mais, e há evidência de que informação no meio é menos utilizada.

**Ignorar tokenização ao explicar limitações.** Contagem de letras, manipulação de caracteres e custo por idioma são consequências diretas dela.

**Falar de modelos específicos e versões em vez de mecanismos.** Modelos mudam a cada trimestre; mecanismos duram. Entrevistadores testam mecanismos.
