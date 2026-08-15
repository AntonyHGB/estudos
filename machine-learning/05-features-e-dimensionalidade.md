# 05 — Features e Dimensionalidade

> Feature engineering, encoding de categóricas, escalonamento, missing values, curse of dimensionality, PCA, seleção de features.
> É o tópico onde a entrevista se aproxima mais do trabalho real. Entrevistadores usam ele para descobrir se você já lidou com dados sujos ou só com datasets de Kaggle já limpos.

---

## 1. Resumo conceitual

### 1.1 Por que feature engineering ainda importa

A frase clichê é "feature engineering é onde se ganha a competição". A versão precisa: **modelos aprendem a relação entre a representação que você dá e o alvo. Mudar a representação muda o que é fácil de aprender.** Uma feature `dia_da_semana` extraída de um timestamp transforma um padrão que uma árvore precisaria de dezenas de splits para aproximar numa única condição. `preço / preço_médio_da_categoria` codifica em uma coluna uma comparação que o modelo teria que descobrir através de uma interação.

Isso não desapareceu com deep learning — mudou de lugar. Em imagem e texto, a rede aprende a representação, então feature engineering manual sumiu. Em **dados tabulares**, que é a maioria dos problemas de negócio, ele continua sendo o maior alavancador de desempenho, à frente da escolha de algoritmo.

**A categoria mais valiosa de features é quase sempre a que codifica conhecimento de domínio ou agregações temporais:** frequência de eventos em janelas (últimos 7/30/90 dias), razões e diferenças em relação a uma referência (média do grupo, valor anterior do próprio cliente), tempo desde o último evento, e contagens de entidades relacionadas. Esse repertório é o que se espera de alguém experiente numa pergunta aberta.

**E a advertência que anda junto:** toda feature agregada é uma fonte potencial de leakage temporal. Uma "média de gastos do cliente" tem que ser calculada apenas com dados anteriores ao instante da predição, o que na prática significa agregação com janela e ponto de corte, não `groupby` na tabela inteira. Ver [03](03-validacao-e-dados.md).

### 1.2 Encoding de variáveis categóricas

**One-hot encoding** — uma coluna binária por categoria. Não impõe ordem, o que é a virtude central. Custo: explode a dimensionalidade com alta cardinalidade, e cada coluna resultante fica esparsa e com pouco sinal individual. Detalhe: descartar uma categoria (*drop first*) evita colinearidade perfeita, o que importa em modelos lineares com intercepto (a "armadilha da variável dummy") e é irrelevante em árvores.

**Label / ordinal encoding** — mapeia categorias para inteiros. **Correto apenas quando existe ordem real** (baixo/médio/alto). Aplicar a categorias nominais em modelos lineares, kNN ou SVM é um erro grave, porque cria uma relação de ordem e distância inventada: "São Paulo=1, Rio=2, Recife=3" faz o modelo acreditar que Rio está entre os outros dois. **Em árvores é menos destrutivo** — a árvore pode isolar valores com múltiplos splits — mas ainda é subótimo, porque ela precisa de vários cortes para separar um grupo que o one-hot ou o suporte nativo separaria com um.

**Target encoding (mean encoding)** — substitui a categoria pela média do alvo naquela categoria. Poderoso com alta cardinalidade porque comprime muita informação em uma coluna. **É também a técnica mais perigosa do arsenal**, por duas razões:

1. **Leakage direto:** se a média inclui a própria linha, o rótulo dela vaza para a feature. Com categorias raras (uma única linha), a feature vira o próprio rótulo, e o modelo aprende a copiar. É o leakage mais insidioso que existe porque não parece leakage.
2. **Overfitting em categorias raras:** a média sobre 2 observações é ruído.

Mitigações obrigatórias: **suavização** em direção à média global, com peso proporcional à contagem (`(soma + m·média_global) / (n + m)`), e cálculo **out-of-fold** — a codificação de cada linha usa apenas outros folds. O CatBoost automatiza isso com *ordered target statistics*, usando apenas linhas anteriores numa permutação.

**Frequency / count encoding** — substitui pela frequência da categoria. Simples, sem leakage de alvo, e surpreendentemente útil: raridade em si costuma ser informativa (um CEP raro, um dispositivo raro).

**Hashing (hashing trick)** — aplica uma função de hash e usa o resto módulo `d`. Dimensão fixa independentemente da cardinalidade, sem precisar armazenar o vocabulário, e lida com categorias novas naturalmente. Custo: **colisões** (categorias distintas colapsam) e perda total de interpretabilidade. Ideal para produção com cardinalidade aberta e crescente.

**Embeddings** — representação densa aprendida. Padrão em redes neurais e o único caminho quando a cardinalidade é enorme (milhões de IDs de produto/usuário) e existe estrutura de similaridade a capturar.

**O problema das categorias não vistas** — uma categoria que aparece só em produção. Estratégias: bucket `"__unknown__"` treinado deliberadamente (agrupando categorias raras no treino para que o modelo aprenda a lidar com o bucket), hashing (que absorve qualquer valor), ou fallback para a média global no target encoding. **Isso precisa ser decidido no design, não descoberto em produção** — e mencionar isso é um sinal claro de experiência real.

### 1.3 Escalonamento

**Quem precisa:** tudo que depende de **distância** (kNN, k-means, SVM, PCA), tudo que usa **regularização** (a penalidade depende da magnitude do coeficiente, que depende da unidade da feature) e **redes neurais** (features em escalas muito diferentes criam superfícies de perda mal-condicionadas e desestabilizam a otimização).

**Quem não precisa:** árvores e ensembles de árvores. Elas só usam a ordem dos valores.

**Métodos:**

- **StandardScaler (z-score):** `(x - μ)/σ`. Padrão. Não limita a faixa e preserva outliers.
- **MinMaxScaler:** para [0,1]. Útil quando há necessidade de faixa fixa (algumas redes, processamento de imagem). **Muito sensível a outliers** — um único valor extremo comprime todo o resto num intervalo minúsculo.
- **RobustScaler:** usa mediana e IQR. Recomendado com outliers.
- **Log / Box-Cox / Yeo-Johnson:** para distribuições assimétricas de cauda longa. Log é transformação, não escalonamento, e muda a natureza da relação: torna multiplicativa uma relação que era aditiva. Especialmente útil em variáveis monetárias.
- **Quantile transform / rank-gauss:** mapeia para uma distribuição alvo (uniforme ou normal) pelos ranks. Muito robusto, destrói a forma original, e é popular em redes neurais sobre dados tabulares.

**Regra inegociável:** o scaler é **ajustado no treino** e aplicado em validação/teste com os parâmetros do treino. Ajustar em tudo é leakage.

### 1.4 Missing values

Antes de escolher a técnica, **diagnostique o mecanismo** — é isso que o entrevistador quer:

- **MCAR** (missing completely at random) — a ausência é independente de tudo. Remover linhas é imparcial (só perde eficiência). Raro na prática.
- **MAR** (missing at random) — a ausência depende de outras variáveis **observadas**. Ex.: renda faltante mais frequente entre jovens, e você observa idade. Imputação condicionada às observadas funciona bem.
- **MNAR** (missing not at random) — a ausência depende do **próprio valor não observado**. Ex.: pessoas de renda muito alta se recusam a informar. **Qualquer imputação é enviesada**, porque a informação que resolveria o viés não está nos dados. A melhor resposta é modelar explicitamente a ausência.

**A observação que vale mais que todas as técnicas: a ausência costuma ser informativa.** Em dados de negócio, MNAR é a regra, não a exceção — um campo vazio geralmente significa que algo não aconteceu, que o cliente não completou uma etapa, ou que um sistema não tinha aquele dado. Por isso, **quase sempre vale criar um indicador binário `x_is_missing`** junto com a imputação. Frequentemente esse indicador é mais preditivo que o valor imputado.

**Técnicas:**

- **Remover linhas** — só com poucos missing e MCAR. Perigoso: pode enviesar a amostra silenciosamente se a ausência é sistemática.
- **Remover a coluna** — se a maioria está ausente e não há sinal no padrão de ausência.
- **Imputar por média/mediana/moda** — baseline. Distorce a distribuição (reduz a variância artificialmente) e enfraquece correlações. Mediana para distribuições assimétricas.
- **Imputar por constante fora do domínio** (-999) — funciona bem **em árvores**, porque a árvore pode isolar o valor com um split e efetivamente aprender "ausente". É péssimo em modelos lineares e kNN, onde -999 é um valor numérico com significado.
- **Imputação por modelo** (kNN, MICE, iterativa) — mais precisa, mais cara, e com risco de leakage se ajustada fora do treino. MICE também dá múltiplas imputações, o que permite propagar a incerteza.
- **Deixar o modelo tratar** — XGBoost e LightGBM aprendem uma **direção padrão por split** para valores ausentes, o que frequentemente é melhor que qualquer imputação porque a decisão é otimizada junto com a perda. Se você usa boosting, esta costuma ser a melhor resposta.

**Cuidado operacional:** a estratégia de imputação precisa ser reproduzível em tempo de inferência. Imputar pela média do batch atual em produção é um bug clássico — o valor muda a cada batch e o modelo passa a ver algo diferente do que viu no treino.

### 1.5 Curse of dimensionality

Conjunto de fenômenos contraintuitivos em alta dimensão:

**O volume cresce exponencialmente.** Para manter a mesma densidade de amostragem, o número de pontos necessários cresce exponencialmente com `p`. Com 10 pontos cobrindo bem uma dimensão, você precisaria de 10^20 para cobrir 20 dimensões igualmente.

**As distâncias se concentram.** Em alta dimensão, a razão entre a distância ao vizinho mais próximo e ao mais distante tende a 1. Consequência direta: **"vizinho mais próximo" deixa de ser um conceito significativo**, o que quebra kNN, k-means e qualquer método baseado em distância. Esse é o efeito mais citado e o mais importante.

**Tudo fica esparso e tudo fica na "casca".** Numa hiperesfera de alta dimensão, quase todo o volume está próximo da superfície. Os dados ficam nos cantos do espaço, longe do centro e uns dos outros.

**Overfitting fica trivial.** Com `p > n`, existe sempre um hiperplano que separa perfeitamente qualquer rotulação — inclusive rótulos aleatórios. Correlações espúrias com o alvo aparecem por acaso: com 10.000 features aleatórias e 100 amostras, algumas terão correlação alta com o alvo puramente por sorte. É a razão de a seleção de features precisar ser feita dentro do CV.

**Por que ML funciona apesar disso — a hipótese da variedade (manifold hypothesis).** Dados reais de alta dimensão tipicamente vivem próximos de uma variedade de dimensão intrínseca muito menor. Uma imagem de 1 megapixel tem um milhão de dimensões, mas o conjunto de imagens plausíveis ocupa uma fração infinitesimal desse espaço. **A dimensão que importa é a intrínseca, não a nominal**, e é isso que redução de dimensionalidade e representation learning exploram. Citar isso transforma uma resposta boa em uma resposta forte.

### 1.6 PCA

Encontra as direções ortogonais de **máxima variância** e projeta os dados nelas. Formalmente: autovetores da matriz de covariância (ou vetores singulares via SVD, que é o que se usa na prática por estabilidade numérica), ordenados por autovalor. O k-ésimo componente é a direção de maior variância ortogonal aos k-1 anteriores.

**Pontos que precisam estar corretos:**

- **Padronizar antes é essencial** quando as features têm unidades diferentes. PCA maximiza variância, e variância depende da unidade — uma feature em milímetros terá variância enorme comparada à mesma em quilômetros e dominará o primeiro componente por artefato de escala.
- **Os componentes são combinações lineares de todas as features originais**, portanto **não são interpretáveis** como as features de origem. Se interpretabilidade é requisito, PCA é o caminho errado.
- **PCA é não-supervisionado**: ignora o alvo. A direção de maior variância **não é necessariamente a mais preditiva** — é perfeitamente possível descartar o componente que carrega todo o sinal preditivo. Se você quer projeção supervisionada, o método análogo é o **LDA**, que maximiza a separação entre classes.
- **Só captura estrutura linear.** Para estrutura não-linear, kernel PCA, autoencoders, UMAP.
- **Sensível a outliers**, porque variância é sensível a outliers.
- Escolha de `k`: variância explicada acumulada (85–95% é o costume), gráfico de scree procurando o "cotovelo", ou — o melhor critério — desempenho na tarefa a jusante medido em validação.

**Usos legítimos:** compressão e velocidade, remoção de multicolinearidade (os componentes são ortogonais por construção), denoising (descartar componentes de baixa variância remove ruído), e visualização em 2D (embora t-SNE/UMAP sejam melhores para isso).

**Quando é uma má ideia:** quando você precisa de interpretabilidade; quando o modelo já lida bem com muitas features (boosting); quando a variância não corresponde a informação relevante; e — erro comum — **como "seleção de features"**, que ele não é: PCA cria features novas usando todas as originais, então você ainda precisa coletar e servir todas elas em produção. Não reduz o custo de aquisição de dados.

### 1.7 Seleção de features

**Por que selecionar:** reduz overfitting (menos oportunidade de correlação espúria), acelera treino e inferência, melhora interpretabilidade, e — o motivo mais subestimado — **reduz custo operacional e superfície de falha em produção**. Cada feature é um pipeline que pode quebrar, atrasar ou driftar.

**Três famílias:**

**Filter** — usa estatísticas dos dados, independentemente do modelo: correlação, informação mútua, qui-quadrado, ANOVA, variância. Rápido e escalável. Limitação séria: avalia features **isoladamente**, então descarta features que só são úteis em interação (uma feature com correlação zero com o alvo pode ser essencial em combinação com outra — XOR é o exemplo canônico) e mantém redundantes.

**Wrapper** — usa o desempenho do próprio modelo: forward selection, backward elimination, **RFE** (Recursive Feature Elimination). Captura interações e considera o modelo específico. Caro (muitos treinos) e propenso a overfittar na validação se você não for cuidadoso.

**Embedded** — a seleção acontece durante o treino: **L1/Lasso** zerando coeficientes, importância de features em modelos de árvore. Melhor custo-benefício na prática.

**A regra que mais cai:** **seleção de features é parte do treino e tem que estar dentro do CV.** Selecionar as top-k por correlação usando o dataset inteiro e depois fazer CV é leakage, e produz resultados espetacularmente falsos quando `p >> n` — é possível obter AUC de 0.9 a partir de features puramente aleatórias assim.

**Alternativa robusta:** permutation importance calculada na validação, ou SHAP agregado. Ambos medem impacto no desempenho real. Cuidado com features correlacionadas em ambos: elas dividem crédito e cada uma parece menos importante do que é.

---

## 2. Perguntas de entrevista

---

**🟢 Como você codifica variáveis categóricas?**

**Resposta modelo:** Depende da cardinalidade e do modelo.

**Baixa cardinalidade** (até algumas dezenas): one-hot, porque não impõe ordem nenhuma. **Ordinal de verdade** (baixo/médio/alto): ordinal encoding, porque a ordem é informação real que eu quero preservar. **Alta cardinalidade** (milhares de CEPs, IDs de produto): one-hot explode, então uso target encoding com suavização e cálculo out-of-fold, ou frequency encoding, ou hashing se a cardinalidade é aberta em produção, ou embeddings se estou usando rede neural.

Se estou usando LightGBM ou CatBoost, considero o **suporte nativo a categóricas**, que costuma ser melhor que one-hot em alta cardinalidade porque a árvore particiona o conjunto de categorias diretamente, sem precisar de um split por categoria.

Uma coisa que eu decidiria explicitamente no design, não em produção: **o que acontece com uma categoria nunca vista**. Agrupo categorias raras num bucket "outros" já no treino, para que o modelo aprenda a lidar com ele, ou uso hashing, que absorve qualquer valor.

**Follow-up:** *"Por que não usar label encoding em tudo? É mais simples."* — Porque inventa ordem e distância que não existem. "SP=1, RJ=2, Recife=3" faz um modelo linear ou um kNN acreditarem que RJ está entre os outros dois. Em árvore o dano é menor, porque ela pode isolar valores com múltiplos splits, mas ainda é subótimo: ela precisa de vários cortes para separar um grupo que o one-hot separaria com um.

---

**🟢 Quando você precisa escalonar features?**

**Resposta modelo:** Quando o algoritmo usa distância ou magnitude. Isso inclui kNN, k-means, SVM e PCA, porque todos operam sobre distâncias e a feature de maior amplitude domina; modelos com regularização L1/L2, porque a penalidade age sobre a magnitude do coeficiente, que depende da unidade da feature; e redes neurais, porque escalas muito diferentes criam superfícies de perda mal-condicionadas e desestabilizam a otimização.

Não preciso escalonar em árvores e ensembles de árvores, porque elas usam apenas a ordem dos valores para escolher pontos de corte.

Escolho o método pelo dado: StandardScaler como padrão, RobustScaler com outliers, MinMax quando preciso de faixa fixa (e sabendo que ele é muito sensível a outliers — um valor extremo comprime tudo o mais num intervalo minúsculo), e log ou quantile transform para distribuições de cauda longa.

E o ponto que não é opcional: **ajusto o scaler apenas no treino** e aplico nos demais conjuntos com os parâmetros do treino. Ajustar no dataset inteiro é leakage.

---

**🟡 Como você lida com missing values?**

**Resposta modelo:** Começo diagnosticando o **mecanismo**, porque ele determina o que é válido. Se é MCAR, remover linhas é imparcial. Se é MAR — a ausência depende de variáveis que eu observo — imputação condicionada funciona. Se é MNAR, ou seja, a ausência depende do próprio valor que falta, como renda alta não declarada, então qualquer imputação é enviesada e a informação que corrigiria isso não está nos dados.

Na prática de dados de negócio, MNAR é a regra: um campo vazio quase sempre significa que algo não aconteceu. Por isso **quase sempre crio um indicador binário de ausência** junto com a imputação — frequentemente ele é mais preditivo que o valor imputado.

Sobre a imputação em si: mediana ou moda como baseline; constante fora do domínio se estou usando árvores, porque a árvore pode isolar aquele valor com um split e aprender "ausente" como categoria; imputação por modelo (MICE, kNN) quando vale o custo. E se estou usando XGBoost ou LightGBM, **frequentemente a melhor opção é não imputar nada** — eles aprendem uma direção padrão para valores ausentes em cada split, otimizada junto com a perda, o que costuma bater imputação manual.

Detalhe operacional: a imputação precisa ser reproduzível em inferência. Imputar pela média do batch atual em produção é um bug comum, porque o valor muda a cada batch.

---

**🟡 O que é PCA e quando você usaria?**

**Resposta modelo:** PCA encontra as direções ortogonais de máxima variância — os autovetores da matriz de covariância, na prática obtidos por SVD — e projeta os dados nas primeiras k. É redução de dimensionalidade linear e não-supervisionada.

Uso para compressão e velocidade, para eliminar multicolinearidade (os componentes são ortogonais por construção), para denoising, e para visualizar em 2D.

Duas coisas que eu sempre verificaria. Primeiro, **padronizar antes** é obrigatório com unidades diferentes, senão a feature de maior variância numérica domina o primeiro componente por artefato de escala. Segundo, **PCA ignora o alvo**: a direção de maior variância não é necessariamente a mais preditiva, e é perfeitamente possível descartar exatamente o componente que carregava o sinal. Se eu quero projeção que preserva separabilidade entre classes, LDA é o método análogo supervisionado.

Não usaria quando interpretabilidade importa, porque os componentes são combinações de todas as features originais; nem quando a estrutura é não-linear, onde kernel PCA, autoencoders ou UMAP são apropriados; nem — e isso é um erro comum — **como substituto de seleção de features**, porque PCA usa todas as features originais para construir os componentes, então eu continuo tendo que coletar e servir todas elas em produção.

**Follow-up:** *"Como escolhe o número de componentes?"* — Variância explicada acumulada, tipicamente 85 a 95%; ou o cotovelo no scree plot; mas o melhor critério é **desempenho na tarefa a jusante medido em validação**, tratando k como hiperparâmetro qualquer.

---

**🟡 O que é a maldição da dimensionalidade?**

**Resposta modelo:** É o conjunto de efeitos que tornam alta dimensão contraintuitiva. O volume do espaço cresce exponencialmente com o número de features, então a densidade de amostragem despenca — manter a mesma cobertura exigiria um número exponencial de pontos.

O efeito mais consequente é que **as distâncias se concentram**: em alta dimensão, a razão entre a distância ao vizinho mais próximo e ao mais distante tende a 1. Isso significa que "vizinho mais próximo" perde significado, o que quebra kNN, k-means e qualquer método baseado em distância. Também fica trivial overfittar: com mais features que amostras, sempre existe um separador perfeito, inclusive para rótulos aleatórios, e correlações espúrias com o alvo aparecem por puro acaso.

A razão de ML funcionar apesar disso é a **hipótese da variedade**: dados reais de alta dimensão vivem próximos de uma variedade de dimensão intrínseca muito menor. Uma imagem tem um milhão de pixels, mas o conjunto de imagens plausíveis ocupa uma fração infinitesimal desse espaço. A dimensão que importa é a intrínseca, não a nominal — e é exatamente isso que redução de dimensionalidade e representation learning exploram.

**Follow-up:** *"Como você mitiga?"* — Redução de dimensionalidade, seleção de features, regularização forte, e usar modelos com viés indutivo apropriado. Em prática moderna, o mais efetivo costuma ser usar embeddings pré-treinados, que já projetam num espaço denso de dimensão intrínseca razoável.

---

**🟡 Explique target encoding e seus riscos.**

**Resposta modelo:** Target encoding substitui cada categoria pela média do alvo naquela categoria. É muito eficaz com alta cardinalidade porque comprime informação de milhares de níveis numa única coluna numérica, e o modelo recebe direto a relação categoria-alvo.

É também a técnica mais perigosa que eu uso, por dois motivos. O primeiro é **leakage direto**: se a média inclui a própria linha, o rótulo dela entra na feature. No limite de uma categoria com uma única observação, a feature **é** o rótulo, e o modelo aprende a copiá-lo. O treino fica espetacular e produção falha completamente. O segundo é **overfitting em categorias raras**: a média sobre duas observações é ruído.

As mitigações são obrigatórias, não opcionais: **suavização** em direção à média global, com peso proporcional à contagem, de forma que categorias raras sejam puxadas para o global; e cálculo **out-of-fold**, em que o encoding de cada linha usa apenas dados de outros folds. O CatBoost automatiza isso com ordered target statistics, calculando o encoding de cada linha só com linhas anteriores numa permutação aleatória, o que é a versão mais rigorosa.

E preciso decidir o que acontece com uma categoria não vista em produção — normalmente fallback para a média global.

---

**🟡 Como você faz seleção de features?**

**Resposta modelo:** Primeiro eu perguntaria por que estou selecionando, porque o objetivo muda o método. Se é para reduzir overfitting, se é para acelerar inferência, ou se é para reduzir custo operacional — cada feature em produção é um pipeline que pode quebrar ou driftar, e essa é a razão mais subestimada.

Na prática eu combino. Começo com **filtros baratos** para eliminar o óbvio: variância zero, duplicatas, features com quase tudo ausente. Depois uso **métodos embedded**, que são os de melhor custo-benefício: L1 zerando coeficientes num modelo linear, ou importância de features num modelo de árvore. Para uma decisão final mais confiável, uso **permutation importance na validação**, porque ela mede impacto no desempenho real e não na estrutura interna do modelo, ou SHAP agregado.

A regra que eu não quebro: **a seleção é parte do procedimento de treino e tem que estar dentro do CV**. Selecionar as top-k por correlação usando o dataset inteiro e depois validar é leakage, e com muitas features e poucas amostras ele produz resultados espetacularmente falsos — dá para obter AUC de 0.9 a partir de ruído puro assim.

**Follow-up 🔴:** *"Por que métodos de filtro univariados podem falhar?"* — Porque avaliam cada feature isoladamente. Uma feature com correlação zero com o alvo pode ser essencial em interação com outra — o XOR é o exemplo canônico, onde nenhuma das duas variáveis tem correlação marginal e juntas determinam o alvo perfeitamente. E filtros univariados mantêm features redundantes, porque não olham a relação entre elas.

**Follow-up:** *"E features correlacionadas na permutation importance?"* — Elas dividem o crédito: ao embaralhar uma, o modelo compensa usando a correlacionada, então ambas parecem pouco importantes. A mitigação é agrupar features correlacionadas e permutar o grupo inteiro, ou usar clustering hierárquico sobre a matriz de correlação antes de interpretar.

---

**🔴 O modelo tem 2.000 features e 800 amostras. Como você aborda?**

**Resposta modelo:** Regime `p >> n`, então minha premissa de trabalho é que **correlações espúrias são a norma** e qualquer resultado bom deve ser tratado como suspeito até ser validado com rigor.

**Validação primeiro, sempre.** Com 800 amostras, um holdout único é ruído. Uso k-fold repetido, e **todo o pré-processamento e toda a seleção de features acontecem dentro de cada fold**. Se eu selecionar features fora do CV, obtenho métricas excelentes a partir de nada — esse é o modo de falha canônico deste regime e é bem documentado em genômica.

**Modelos de alto bias e forte regularização.** Regressão logística com L1 ou Elastic Net, ou um modelo linear com regularização pesada. Nada de árvores profundas ou redes. Elastic Net especificamente, porque com 2.000 features é provável que existam grupos correlacionados, e o L1 puro escolheria um membro de cada grupo arbitrariamente, produzindo uma seleção instável.

**Redução de dimensionalidade** como alternativa: PCA para uns poucos componentes, ou — se houver estrutura de grupos conhecida no domínio — agregações informadas por conhecimento, que costumam bater métodos automáticos.

**Conhecimento de domínio antes de método automático.** Com 800 amostras, um especialista indicando 30 features plausíveis quase sempre bate seleção automática sobre 2.000, porque a seleção automática está estimando 2.000 relações com 800 pontos.

**Estabilidade como critério.** Eu verificaria se a seleção é estável sob reamostragem: se refazer o CV com outra semente escolhe features completamente diferentes, a seleção é ruído e eu não deveria acreditar em nenhuma delas.

**E expectativas honestas.** Com esse regime, eu reportaria intervalos amplos e resistiria a afirmar que features específicas são importantes. A resposta profissional inclui dizer que a conclusão mais provável é "precisamos de mais amostras", e quantificar quantas.

---

**🔴 Você tem timestamps. Que features extrai?**

**Resposta modelo:** Dividiria em três blocos.

**Componentes de calendário:** hora do dia, dia da semana, dia do mês, mês, trimestre, se é fim de semana, se é feriado (com calendário local, que importa mais do que parece em dados brasileiros), e proximidade a datas comerciais relevantes. Para os cíclicos eu usaria **codificação senoidal** — `sin(2πh/24)` e `cos(2πh/24)` — para que hora 23 e hora 0 fiquem próximas no espaço de features. Isso importa muito em modelos lineares e redes; em árvores importa menos, porque a árvore pode isolar os valores com splits, mas ainda ajuda.

**Features de recência e frequência**, que costumam ser as mais preditivas em problemas de comportamento: tempo desde o último evento do usuário, contagem de eventos em janelas de 1/7/30/90 dias, intervalo médio entre eventos, e tendência (razão entre a janela curta e a longa, que captura aceleração ou desaceleração de comportamento).

**Features de contexto temporal:** tempo desde o cadastro (idade da conta), posição no ciclo de faturamento, e — quando relevante — se aquele instante é atípico para aquele usuário comparado ao histórico dele.

**A ressalva mais importante:** toda feature agregada precisa ser calculada com **ponto de corte** no instante da predição. Um `groupby` sobre a tabela inteira para calcular "média de compras do cliente" inclui o futuro e é leakage. Na prática isso significa agregações com janela relativa a cada linha, o que é a parte cara e a parte que dá errado. E eu adicionaria: features de janela precisam ser reproduzíveis em tempo de inferência com os mesmos limites, o que é exatamente o problema que uma **feature store** existe para resolver.

**Follow-up:** *"Usaria o timestamp bruto como feature?"* — Em árvores, quase nunca: o modelo aprende cortes em datas específicas do treino, o que não generaliza para o futuro, e árvores não extrapolam, então qualquer data futura cai na última folha. Se existe tendência, eu a modelaria explicitamente (detrend, ou um termo de tendência num modelo aditivo), ou trabalharia com diferenças em vez de níveis.

---

**🔴 Quando adicionar features piora o modelo?**

**Resposta modelo:** Alguns casos, e o interessante é que nem todos são sobre overfitting.

**Features irrelevantes adicionam variância.** Cada feature é mais uma chance de correlação espúria, e o efeito é mais grave quanto menor o dataset. Em kNN e em métodos de distância, o efeito é dramático: features irrelevantes contribuem ruído para a métrica de distância e degradam diretamente a noção de vizinhança.

**Features redundantes desestabilizam.** Em modelos lineares, multicolinearidade infla a variância dos coeficientes. As previsões podem continuar boas, mas a interpretação vira ruído e o modelo fica instável sob reamostragem.

**Features com leakage "melhoram" offline e destroem produção.** É o caso mais caro. A feature parece excelente e é o motivo de o modelo falhar.

**Features indisponíveis ou atrasadas em inferência.** Uma feature que existe no warehouse mas chega com horas de atraso em tempo real gera treino-serving skew: o modelo foi treinado com um valor que não existe no momento da decisão.

**Features instáveis no tempo.** Uma feature com distribuição que muda rápido gera drift e obriga retreino frequente. Ela pode melhorar a métrica hoje e degradar a manutenibilidade permanentemente.

**Features com custo desproporcional.** Uma feature que exige uma chamada externa cara e adiciona 0,2% de AUC piora o sistema, mesmo melhorando o modelo. A métrica que importa não é a do modelo isolado.

O critério que eu usaria: não é "essa feature melhora a validação?", é **"o ganho justifica o custo total de aquisição, manutenção, latência e risco?"**. É a diferença entre pensar como quem treina modelos e pensar como quem opera sistemas.

---

## 3. Armadilhas comuns

**Ajustar scaler ou imputador no dataset inteiro.** Leakage clássico. `fit` só no treino, dentro de cada fold.

**Label encoding em categóricas nominais para modelos que usam distância.** Cria ordem inexistente.

**Target encoding sem out-of-fold e sem suavização.** Leakage direto e overfitting em categorias raras.

**Não planejar categorias não vistas.** Quebra em produção no primeiro valor novo.

**Escalonar para árvores.** Inofensivo, mas revela que você não sabe por que escalona.

**Não escalonar antes do PCA.** Faz o primeiro componente refletir escolha de unidade.

**Achar que PCA é seleção de features.** Ele cria features novas a partir de todas as originais; você continua precisando coletar todas.

**Usar PCA assumindo que variância = informação preditiva.** PCA é cego ao alvo.

**Fazer seleção de features fora do CV.** Produz resultados falsos, especialmente com p >> n.

**Imputar sem indicador de ausência.** Joga fora sinal que muitas vezes é o mais forte que existe.

**Imputar com a média sem notar que o mecanismo é MNAR.** Enviesa sistematicamente e a imputação parece razoável.

**Calcular features agregadas sem ponto de corte temporal.** Leakage silencioso e muito comum.

**Adicionar features sem verificar disponibilidade em inferência.** Treino-serving skew.

**Codificar hora ou mês como inteiro em modelo linear.** Hora 23 e hora 0 ficam a 23 unidades de distância. Use codificação cíclica.

**Otimizar o modelo antes de investir em features.** Em tabular, features quase sempre pagam mais que troca de algoritmo.
