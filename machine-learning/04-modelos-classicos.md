# 04 — Modelos Clássicos

> Regressão linear e logística, árvores, random forest, gradient boosting, SVM, kNN, Naive Bayes.
> Em vagas de dados tabulares, este é o tópico central. O que se avalia não é se você sabe o que é uma random forest — é se você sabe **por que escolheria uma**.

---

## 1. Resumo conceitual

### 1.1 Regressão linear

Modela `y = w·x + b`, ajustando `w` para minimizar o erro quadrático. Tem solução analítica (`w = (XᵀX)⁻¹Xᵀy`, as equações normais), o que é elegante mas raramente usado em escala porque inverter uma matriz `p×p` custa `O(p³)` e a inversão é numericamente instável com multicolinearidade — na prática se usa decomposição QR/SVD ou gradiente descendente.

**As suposições** (cobradas com frequência, e o valor está em saber **o que cada violação quebra**):

1. **Linearidade** nos parâmetros — a relação entre features e alvo é linear. Violar isso gera bias; a correção é adicionar termos polinomiais, interações ou transformações (log).
2. **Independência dos resíduos** — violada em séries temporais e dados agrupados. Não enviesa os coeficientes, mas **subestima os erros-padrão**, então seus p-valores e intervalos de confiança ficam otimistas demais.
3. **Homocedasticidade** — variância constante dos resíduos. Violar não enviesa os coeficientes, mas invalida a inferência. Corrige-se com erros-padrão robustos ou transformando o alvo.
4. **Normalidade dos resíduos** — necessária apenas para inferência exata em amostras pequenas. Em amostras grandes o TCL cobre. **Não é necessária para a estimativa dos coeficientes.**
5. **Ausência de multicolinearidade perfeita** — com colinearidade alta, os coeficientes ficam instáveis e com erros-padrão enormes, mas as **previsões continuam boas**.

O ponto que impressiona: **essas suposições existem para a inferência estatística (p-valores, intervalos de confiança), não para a predição.** Se você só quer prever, violar normalidade e homocedasticidade não te impede de ter um modelo útil. Se você vai afirmar "esta variável tem efeito significativo", elas passam a importar muito. Saber separar os dois usos é sinal de maturidade estatística.

**Multicolinearidade:** quando features são fortemente correlacionadas, `XᵀX` fica mal-condicionada. Consequência: coeficientes com variância enorme, sinais que trocam com pequenas mudanças nos dados, e interpretação individual sem sentido — mas capacidade preditiva preservada. Diagnóstico via **VIF** (Variance Inflation Factor; VIF > 5–10 é sinal de alerta). Correções: remover redundantes, PCA, ou regularização L2, que é literalmente o `λI` adicionado a `XᵀX` para estabilizá-la.

### 1.2 Regressão logística

Apesar do nome, é classificação. Modela a **log-odds** como função linear das features:

```
log( p / (1-p) ) = w·x + b        ⟺        p = σ(w·x + b) = 1 / (1 + e^(-(w·x+b)))
```

**Por que a sigmoide e não uma reta?** Porque probabilidade tem que estar em [0,1] e uma função linear não respeita isso. A sigmoide é a inversa da função logit, que mapeia (0,1) para toda a reta real. E há uma razão mais profunda: a logística é o **modelo linear generalizado canônico para a distribuição de Bernoulli** — a log-odds é a *link function* natural, o que dá à escolha uma justificativa teórica em vez de conveniência.

**Interpretação dos coeficientes** (cobrada muito):`w_j` é a mudança na **log-odds** para um aumento unitário em `x_j`, mantendo o resto constante. `exp(w_j)` é a **razão de chances (odds ratio)**: se `exp(w_j) = 1.5`, a chance aumenta 50% por unidade da feature. **`w_j` NÃO é a mudança na probabilidade** — o efeito na probabilidade depende de onde você está na curva (é máximo perto de `p = 0.5` e quase nulo nos extremos). Errar isso é comum e é um sinal ruim.

**Por que log-loss e não MSE?** Duas razões, e a segunda é a que separa candidatos:

1. **Estatística:** log-loss é a log-verossimilhança negativa sob o modelo de Bernoulli. Minimizar log-loss = fazer MLE. É a perda principiada.
2. **De otimização:** MSE aplicado à saída da sigmoide é **não-convexa** em `w`, criando mínimos locais. A log-loss composta com a sigmoide é **convexa**, garantindo mínimo global. Além disso, o gradiente da log-loss em relação aos pesos vale simplesmente `(p - y)·x` — a sigmoide se cancela — enquanto com MSE o gradiente carrega o fator `σ'(z)`, que **satura perto de 0 e 1**, fazendo o aprendizado quase parar exatamente quando o modelo está confiante e errado. É o mesmo argumento de saturação que aparece em [07 — Redes neurais](07-redes-neurais.md).

**Por que a logística continua relevante em 2026:** é rápida, calibrada por construção (log-loss é uma proper scoring rule), interpretável em nível regulatório (crédito, saúde), escala para bilhões de linhas, e é o **baseline obrigatório**. Se seu gradient boosting supera a logística em 1 ponto de AUC, a resposta certa raramente é usar o boosting.

**Separação perfeita:** se uma feature separa perfeitamente as classes, o MLE não existe — os coeficientes divergem para infinito buscando previsões de 0 e 1 exatos. Detecta-se por coeficientes gigantescos e erros-padrão gigantescos. Regularização resolve, o que é uma boa razão prática para sempre usar um pouco de L2.

### 1.3 Árvores de decisão

Particionam o espaço recursivamente com splits do tipo `x_j ≤ t`, escolhendo a cada nó o split que mais reduz uma medida de impureza.

**Critérios de impureza (classificação):**

- **Gini:** `1 - Σ p_i²`. Interpretação: probabilidade de classificar errado um elemento rotulado aleatoriamente segundo a distribuição do nó.
- **Entropia:** `-Σ p_i log p_i`. O ganho de informação é a redução de entropia.

Na prática **produzem árvores quase idênticas**; Gini é ligeiramente mais rápido (sem logaritmo) e é o padrão em várias bibliotecas. Se um entrevistador insiste na diferença, a resposta honesta é "raramente importa, e é um hiperparâmetro que eu não priorizaria ajustar" — isso é melhor que inventar uma distinção grande.

Para regressão, o critério é redução de variância (MSE), e a predição da folha é a média dos alvos nela.

**Propriedades essenciais:**

- **Captura interações e não-linearidades automaticamente** — cada caminho da raiz à folha é uma conjunção de condições, o que é uma interação de ordem alta sem você especificar nada. É a principal razão de árvores dominarem dados tabulares.
- **Invariante a transformações monótonas das features** — a árvore só usa a **ordem** dos valores para escolher os pontos de corte. Por isso **escalonamento é desnecessário** em árvores, e aplicar log numa feature não muda nada (o que também significa que log não ajuda em árvores, ao contrário de modelos lineares).
- **Lida com missing values** de forma nativa em várias implementações (surrogate splits em CART, direção padrão aprendida em XGBoost/LightGBM).
- **Fronteiras de decisão paralelas aos eixos** — a limitação estrutural. Uma fronteira diagonal exige uma escada de muitos splits para ser aproximada. É a razão de árvores serem ruins em problemas geométricos/de sinal e ótimas em dados tabulares heterogêneos.
- **Alta variância** — pequenas mudanças nos dados mudam o split raiz e cascateiam, produzindo uma árvore inteiramente diferente. É a fraqueza que motiva ensembles.
- **Não extrapola** — a predição é sempre a média de folhas observadas, portanto limitada ao intervalo dos alvos vistos no treino. Uma árvore **jamais** prevê um valor fora da faixa de treino. Isso é decisivo em séries temporais com tendência: gradient boosting não consegue prever crescimento continuado, e é por isso que se costuma modelar diferenças ou detrend antes.

**Controle de complexidade:** profundidade máxima, mínimo de amostras por folha/split, número máximo de folhas, e **cost-complexity pruning** (crescer completa e podar depois, penalizando o número de folhas). Podar depois é geralmente melhor que parar cedo, porque um split ruim pode habilitar um split ótimo abaixo dele — o critério guloso não enxerga isso.

### 1.4 Ensembles: bagging vs boosting

**Bagging (Bootstrap Aggregating):** treinar M modelos em amostras bootstrap dos dados e agregar (média/voto). Reduz **variância** sem alterar muito o bias. A matemática que sustenta: se você faz a média de M variáveis com variância `σ²` e correlação par-a-par `ρ`, a variância da média é `ρσ² + (1-ρ)σ²/M`. O segundo termo some com M grande; **o primeiro termo, `ρσ²`, é o piso**. Ou seja, **a correlação entre os modelos é o que limita o ganho** — daí toda a engenharia de descorrelação. Modelos-base devem ser de baixo bias e alta variância (árvores profundas). Paralelizável.

**Random Forest** = bagging de árvores + **amostragem aleatória de features em cada split**. Essa segunda parte é o insight central: sem ela, todas as árvores escolheriam a mesma feature dominante na raiz e ficariam altamente correlacionadas, e a média não reduziria quase nada. Ao forçar cada split a considerar só um subconjunto aleatório (tipicamente `√p` para classificação, `p/3` para regressão), as árvores ficam individualmente piores e coletivamente muito melhores. **Explicar isso é a resposta que distingue quem entende de quem decorou.**

Bônus da RF: **erro OOB (out-of-bag)** — cada árvore não vê ~37% dos dados (a probabilidade de um exemplo não ser sorteado em n tentativas com reposição é `(1-1/n)^n → 1/e ≈ 0.368`), o que dá uma estimativa de validação praticamente de graça.

**Boosting:** treinar modelos **sequencialmente**, cada um corrigindo os erros do anterior. Reduz principalmente **bias**, somando aprendizes fracos (árvores rasas) numa função forte. Não paralelizável entre árvores (embora a construção de cada árvore seja paralelizável). **Pode overfittar** se você adicionar árvores demais — já na random forest, aumentar o número de árvores tende a estabilizar a variância e não aumenta a complexidade de cada árvore, embora a métrica observada ainda possa oscilar.

**Gradient Boosting:** formaliza boosting como **gradiente descendente no espaço de funções**. A cada iteração, ajusta-se uma árvore ao **gradiente negativo da perda** em relação às predições atuais (os "pseudo-resíduos") e soma-se essa árvore ao modelo com um fator de encolhimento (learning rate). Para MSE, o gradiente negativo é literalmente o resíduo `y - ŷ`, e é daí que vem a intuição "cada árvore aprende o erro da anterior" — mas a formulação geral funciona para **qualquer perda diferenciável**, o que é o que torna o método tão versátil (log-loss, Huber, ranking, Poisson, quantílica).

### 1.5 XGBoost, LightGBM, CatBoost

Todos são implementações de gradient boosting em árvores. As diferenças:

**XGBoost** — o que o tornou dominante: **regularização explícita na função objetivo** (penaliza o número de folhas e a norma L2 dos valores das folhas), uso da **segunda derivada** (aproximação de Newton, não só o gradiente), tratamento nativo de missing values aprendendo uma direção padrão por split, e uma implementação altamente otimizada. Cresce árvores **level-wise** (por nível) por padrão, o que produz árvores balanceadas e regularização mais uniforme. Versões recentes suportam categóricas nativamente e crescimento leaf-wise opcional (`grow_policy='lossguide'`).

**LightGBM** — otimizado para velocidade em datasets grandes. Duas ideias principais: **crescimento leaf-wise** (best-first — expande sempre a folha de maior ganho, em vez de nível a nível), o que atinge menor perda com menos folhas mas produz árvores desbalanceadas e **overfitta mais facilmente em datasets pequenos** (daí a importância de `num_leaves` e `min_data_in_leaf`); e **histogram-based splitting**, que discretiza features contínuas em bins, reduzindo drasticamente o custo de encontrar splits. Também tem **suporte nativo a categóricas** com um algoritmo de particionamento de categorias, embora com cardinalidade muito alta ele fique lento e valha agrupar categorias raras. Regra prática: **LightGBM para dados grandes, XGBoost quando o dataset é menor e a estabilidade importa mais que velocidade.**

**CatBoost** — foco em features categóricas e em evitar um viés sutil. Usa **ordered target statistics**: o target encoding de cada linha é calculado usando apenas linhas "anteriores" numa permutação aleatória, o que evita que o encoding de uma linha use o próprio rótulo dela — um leakage sutil que infla o treino. Também usa **oblivious trees** (mesma condição de split em todo um nível), que são mais rápidas na inferência e agem como regularização. Costuma ser o mais forte "out of the box" com muitas categóricas de alta cardinalidade.

**A resposta honesta em 2026:** a diferença de acurácia entre os três é pequena na maioria dos problemas reais, e **feature engineering e validação correta importam muito mais que a escolha da biblioteca**. Dizer isso numa entrevista é mais forte que defender apaixonadamente uma delas.

**Hiperparâmetros que realmente importam** (por ordem de impacto): `learning_rate` (menor = melhor, com mais árvores; a dupla `learning_rate` + `n_estimators` é o eixo principal), profundidade / `num_leaves`, `min_child_weight` / `min_data_in_leaf`, `subsample` e `colsample_bytree` (estocasticidade que regulariza), e as penalidades L1/L2. **Early stopping em um conjunto de validação** é o mecanismo prático que define `n_estimators` e é obrigatório.

### 1.6 SVM

Encontra o hiperplano que **maximiza a margem** — a distância aos pontos mais próximos de cada classe. A intuição: entre infinitos separadores possíveis, o de margem máxima é o mais "seguro", porque é o que mais tolera perturbação nos dados antes de errar. A teoria de generalização associa margem grande a menor risco esperado.

**Soft margin (C):** dados reais não são separáveis, então permite-se violação com penalidade. `C` controla o trade-off: **C alto** = pouca tolerância a erro = margem estreita = **mais overfitting**; **C baixo** = mais tolerância = margem larga = mais regularização. `C` é essencialmente o inverso da força de regularização.

**Kernel trick:** o problema dual depende dos dados **apenas por produtos internos** `x_i · x_j`. Substituindo o produto interno por uma função kernel `K(x_i, x_j)`, você opera implicitamente num espaço de alta dimensão **sem nunca calcular as coordenadas nesse espaço**. O RBF corresponde a um espaço de dimensão infinita. Entender que o truque é "produto interno em outro espaço, calculado barato" — e não "projetar os dados" — é o que se está avaliando.

Kernels: linear (texto de alta dimensão, dados já separáveis), polinomial, **RBF** (`exp(-γ||x-x'||²)`, o padrão para não-linearidade). `γ` controla o alcance de influência de cada ponto: **γ alto** = influência local = fronteiras muito flexíveis = overfitting; **γ baixo** = suave, aproximando o linear. `C` e `γ` interagem e devem ser ajustados juntos.

**Vetores de suporte** são os pontos na margem ou violando-a. **Só eles definem a solução** — remover qualquer outro ponto não muda nada. Isso torna SVM eficiente em memória na predição, mas também frágil: os pontos que definem o modelo são os mais próximos da fronteira, ou seja, potencialmente os mais ruidosos.

**Quando SVM ainda vale (2026):** datasets pequenos a médios (até ~dezenas de milhares) com muitas features, especialmente `p > n` (texto, bioinformática). **Quando não vale:** datasets grandes — o treino é entre `O(n²)` e `O(n³)`, o que o torna proibitivo; quando você precisa de probabilidades (SVM produz distâncias, não probabilidades; o Platt scaling do `probability=True` é um remendo caro); e em dados tabulares heterogêneos, onde gradient boosting é melhor e mais fácil. SVM perdeu espaço, mas continua sendo pergunta de entrevista pela riqueza conceitual (margem, dual, kernel).

### 1.7 kNN

Sem treino: guarda os dados e, na predição, encontra os k vizinhos mais próximos e agrega (voto ou média). É o exemplo canônico de aprendizado **preguiçoso** (lazy) e **não-paramétrico** — a complexidade do modelo cresce com os dados.

**k controla o bias-variance de forma pura:** `k=1` tem erro de treino zero e variância máxima (a fronteira contorna cada ponto, inclusive ruído); `k` grande suaviza, aumentando bias; `k = n` prevê sempre a classe majoritária (bias total).

**O que quebra o kNN:**

- **Escalonamento é obrigatório.** A distância é dominada pela feature de maior amplitude numérica. Salário em reais versus idade em anos: o salário determina tudo.
- **Curse of dimensionality.** Em alta dimensão, todas as distâncias convergem para valores parecidos, e "vizinho mais próximo" deixa de ser um conceito significativo. É o algoritmo mais afetado por isso.
- **Custo de predição `O(n·p)` por consulta.** Escala mal. Mitigações: KD-tree/Ball-tree (que degradam para busca linear acima de ~20 dimensões) ou **ANN** — HNSW, IVF, produto quantizado — que é exatamente a tecnologia por trás dos bancos de dados vetoriais usados em RAG. Essa conexão é ótima de fazer numa entrevista moderna: **busca vetorial em RAG é kNN aproximado sobre embeddings**.
- **Features irrelevantes envenenam a distância**, porque contribuem ruído para a métrica sem contribuir sinal.

### 1.8 Naive Bayes

Aplica o teorema de Bayes com a suposição "ingênua" de que as features são **condicionalmente independentes dado a classe**:

```
P(y|x₁...xₚ) ∝ P(y) · Π P(xⱼ|y)
```

A suposição é quase sempre falsa (em texto, "nova" e "york" não são independentes). Mesmo assim funciona surpreendentemente bem para **classificação**, e a razão é importante: para classificar, você só precisa que a **ordenação** das probabilidades entre classes esteja correta, não que os valores estejam. A violação da independência distorce as magnitudes — empurrando as probabilidades para 0 e 1, tornando o modelo **muito descalibrado** — mas frequentemente preserva qual classe é a maior. Então **Naive Bayes é um classificador decente e um estimador de probabilidade ruim**. Essa distinção é uma resposta 🔴 excelente.

Variantes: **Multinomial** (contagens, texto), **Bernoulli** (presença/ausência), **Gaussiano** (features contínuas, assumindo normalidade por classe).

**Suavização de Laplace** é essencial: sem ela, uma palavra nunca vista numa classe dá `P(x|y) = 0` e zera o produto inteiro — um único termo desconhecido veta a classe. Somar 1 (ou α) a todas as contagens evita isso.

**Detalhe de implementação que vale saber:** calcula-se em **log** (`log P(y) + Σ log P(xⱼ|y)`), porque o produto de milhares de probabilidades pequenas causa underflow numérico.

**Quando usar:** baseline rapidíssimo em classificação de texto, datasets muito pequenos (a forte suposição age como regularização brutal, o que ajuda quando não há dados para estimar dependências), e situações que exigem treino em tempo real com atualização incremental trivial.

### 1.9 Tabela de decisão

| Modelo | Bias | Variância | Escalonar? | Interpretável | Escala (n grande) | Melhor uso |
|---|---|---|---|---|---|---|
| Regressão linear/logística | Alto | Baixa | **Sim** (com reg.) | Alta | Excelente | Baseline, interpretabilidade, regulação |
| Árvore de decisão | Baixo | **Alta** | Não | Alta (se rasa) | Boa | Regras explicáveis, baseline não-linear |
| Random Forest | Baixo | Média | Não | Média | Boa | Padrão robusto, pouco tuning |
| Gradient Boosting | Baixo | Média-alta | Não | Média | Boa | **Padrão vencedor em tabular** |
| SVM (RBF) | Baixo | Média | **Sim** | Baixa | Ruim (O(n²–n³)) | p > n, datasets pequenos |
| kNN | Baixo (k pequeno) | Alta | **Sim** | Média | Ruim na predição | Baseline, poucos dados, busca por similaridade |
| Naive Bayes | Alto | Baixa | Não | Média | Excelente | Texto, baseline instantâneo |

---

## 2. Perguntas de entrevista

---

**🟢 Qual a diferença entre regressão linear e logística?**

**Resposta modelo:** Linear prevê um valor contínuo e não tem restrição de faixa; logística prevê a probabilidade de uma classe e restringe a saída a [0,1] aplicando a sigmoide ao mesmo preditor linear. A logística é, na verdade, linear na **log-odds**: `log(p/(1-p)) = w·x + b`.

Elas também usam perdas diferentes: linear usa erro quadrático, logística usa log-loss, que é a verossimilhança negativa sob Bernoulli. Isso não é arbitrário — usar MSE com a sigmoide torna o problema não-convexo e satura o gradiente quando o modelo está confiante e errado, o que trava o aprendizado justo quando ele mais precisaria corrigir.

**Follow-up quase garantido:** *"O que significa um coeficiente de 0.5 na logística?"* — Que um aumento de uma unidade naquela feature aumenta a log-odds em 0.5, ou seja, multiplica a **razão de chances** por `e^0.5 ≈ 1.65`, um aumento de 65% nas chances. **Não** é um aumento de 0.5 na probabilidade — o efeito sobre a probabilidade depende de onde você está na curva, sendo máximo perto de 0.5 e quase nulo nos extremos.

---

**🟢 O que é uma árvore de decisão e qual sua principal fraqueza?**

**Resposta modelo:** Particiona o espaço recursivamente, escolhendo a cada nó o corte que mais reduz impureza — Gini ou entropia em classificação, variância em regressão. A predição é a estatística da folha em que o exemplo cai.

A principal fraqueza é **alta variância**: uma pequena mudança nos dados pode alterar o split da raiz, e isso cascateia mudando a árvore inteira. Por isso árvores isoladas raramente são usadas para predição — usam-se ensembles, que existem exatamente para atacar essa variância.

Uma segunda limitação estrutural é que as fronteiras são paralelas aos eixos, então uma fronteira diagonal exige uma escada de muitos splits para ser aproximada. E uma terceira, muito importante na prática: **árvores não extrapolam** — a predição é sempre a média de valores vistos, então nunca sai da faixa de alvos do treino.

**Follow-up:** *"Preciso escalonar features para uma árvore?"* — Não. A árvore só usa a ordem dos valores para escolher pontos de corte, então é invariante a qualquer transformação monótona. Isso também significa que aplicar log numa feature não muda nada numa árvore, ao contrário do que acontece num modelo linear.

---

**🟡 Explique a diferença entre bagging e boosting.**

**Resposta modelo:** Bagging treina modelos **em paralelo** em amostras bootstrap e agrega por média ou voto. Ele reduz **variância** — a média de modelos ruidosos e descorrelacionados é mais estável que qualquer um deles. Por isso os modelos-base devem ser de baixa polarização e alta variância: árvores profundas.

Boosting treina modelos **sequencialmente**, cada um focando nos erros do anterior, e soma-os. Ele reduz principalmente **bias** — parte de aprendizes fracos, árvores rasas, e os compõe numa função forte.

Três consequências práticas. Bagging é paralelizável e boosting não é (entre árvores). Boosting geralmente atinge acurácia maior mas é mais sensível a hiperparâmetros e a ruído. E **boosting pode overfittar com árvores demais**, enquanto a random forest tende a estabilizar ao adicionar árvores: mais árvores não tornam cada estimador mais complexo, mas a métrica finita ainda pode oscilar.

**Follow-up quase garantido:** *"Por que a random forest amostra features em cada split, além do bootstrap?"* — Para **descorrelacionar as árvores**. A variância da média de M modelos com correlação ρ é `ρσ² + (1-ρ)σ²/M`: o segundo termo desaparece com M grande, mas o primeiro, `ρσ²`, é um piso que só cai reduzindo a correlação. Só com bootstrap, todas as árvores escolheriam a mesma feature dominante na raiz e ficariam muito parecidas, então a média não ganharia quase nada. Ao restringir cada split a um subconjunto aleatório de features, cada árvore fica individualmente pior e o conjunto fica muito melhor.

**Follow-up 🔴:** *"O que é o erro OOB?"* — Cada árvore bootstrap não vê cerca de 37% dos dados, porque a chance de um exemplo nunca ser sorteado em n tentativas com reposição tende a 1/e. Avaliar cada exemplo apenas nas árvores que não o viram dá uma estimativa de validação essencialmente de graça, sem precisar de CV.

---

**🟡 Como o gradient boosting funciona? Por que ele geralmente vence em dados tabulares?**

**Resposta modelo:** Gradient boosting é gradiente descendente no **espaço de funções**. Você começa com uma predição constante e, a cada iteração, calcula o gradiente negativo da perda em relação às predições atuais — os pseudo-resíduos — ajusta uma árvore rasa a esses pseudo-resíduos e a soma ao modelo, multiplicada por um learning rate pequeno. Para erro quadrático, o gradiente negativo é literalmente o resíduo, e é daí que vem a intuição de "cada árvore aprende o erro da anterior"; mas a formulação geral vale para qualquer perda diferenciável, o que é o que dá versatilidade ao método.

Ele vence em tabular por várias razões combinadas. **Captura interações automaticamente** — cada caminho da árvore é uma conjunção de condições, sem precisar especificar nada. **Lida naturalmente com features heterogêneas** — escalas diferentes, categóricas, distribuições assimétricas, sem pré-processamento. **É invariante a transformações monótonas.** **Trata missing values nativamente.** E — o ponto de fundo — dados tabulares **não têm a estrutura composicional** (localidade, invariância a translação) que redes profundas foram feitas para explorar; as features já são semanticamente significativas, então não há hierarquia de representações a descobrir.

**Follow-up:** *"Quais hiperparâmetros importam mais?"* — `learning_rate` junto com o número de árvores é o eixo principal: learning rate menor com mais árvores costuma generalizar melhor, e eu deixo o número de árvores ser definido por early stopping numa validação. Depois, profundidade ou `num_leaves`, o mínimo de amostras por folha, e a estocasticidade (`subsample`, `colsample_bytree`), que regulariza. As penalidades L1/L2 explícitas são ajuste fino.

**Follow-up 🔴:** *"Gradient boosting overfitta?"* — Sim, e de duas formas. Com árvores demais, porque cada uma continua reduzindo o erro de treino indefinidamente — early stopping resolve. E com árvores profundas demais, que capturam ruído. Na random forest, mais árvores apenas estabilizam a agregação, sem aumentar a complexidade de cada estimador; no boosting, cada árvore nova aumenta a função aprendida. É também por isso que boosting é mais sensível a rótulos ruidosos: ele foca sequencialmente nos exemplos mal-classificados, e se esses são erros de rotulagem, ele os persegue ativamente.

---

**🟡 XGBoost, LightGBM e CatBoost: quais as diferenças e quando usar cada um?**

**Resposta modelo:** Os três são gradient boosting em árvores, e a diferença de acurácia entre eles é pequena na maioria dos problemas reais — feature engineering e validação correta importam muito mais.

**XGBoost** popularizou a regularização explícita no objetivo, penalizando número de folhas e a norma dos valores das folhas, e usa a segunda derivada da perda numa aproximação tipo Newton. Cresce árvores **level-wise** por padrão, o que dá árvores balanceadas e regularização mais uniforme.

**LightGBM** é otimizado para velocidade com duas ideias: crescimento **leaf-wise**, que expande sempre a folha de maior ganho e atinge menor perda com menos folhas, e splitting baseado em histogramas, que discretiza features contínuas em bins. O custo é que leaf-wise **overfitta mais facilmente em datasets pequenos**, então `num_leaves` e o mínimo de dados por folha precisam ser controlados. Também tem suporte nativo a categóricas.

**CatBoost** foca em categóricas com *ordered target statistics*, que calcula o encoding de cada linha usando apenas linhas anteriores numa permutação — isso evita um leakage sutil em que o rótulo da própria linha entra no encoding dela. Usa árvores obliviosas, que são rápidas na inferência e funcionam como regularização.

Na prática: **LightGBM quando o dataset é grande e velocidade importa; CatBoost quando há muitas categóricas de alta cardinalidade; XGBoost quando o dataset é menor e eu prefiro estabilidade e árvores balanceadas.** Eu testaria dois deles com early stopping e escolheria pelo resultado na validação, sem religião.

---

**🟡 Explique o kernel trick.**

**Resposta modelo:** A formulação dual do SVM depende dos dados **apenas através de produtos internos** entre pares de pontos. Isso permite substituir o produto interno por uma função kernel `K(x, x')`, que corresponde ao produto interno num espaço de features de maior dimensão — **sem nunca calcular as coordenadas naquele espaço**. É isso que é o truque: você obtém o poder de um espaço de alta dimensão pagando o custo de uma função de dois vetores no espaço original.

O RBF, `exp(-γ||x-x'||²)`, corresponde a um espaço de dimensão infinita, o que seria impossível de computar explicitamente. O parâmetro γ controla o alcance da influência de cada ponto: γ alto torna a influência muito local e as fronteiras muito flexíveis, levando a overfitting; γ baixo suaviza e aproxima o comportamento linear. γ e C interagem e precisam ser ajustados juntos.

**Follow-up:** *"Por que SVM não é mais tão usado?"* — Escala. O treino é entre O(n²) e O(n³), o que é proibitivo com centenas de milhares de exemplos. Além disso, não produz probabilidades diretamente, e em dados tabulares gradient boosting é melhor e requer menos cuidado com escalonamento. SVM continua bom em regimes com muitas features e poucas amostras, como texto ou bioinformática.

**Pegadinha:** *"É obrigatório escalonar para SVM?"* — Sim. O RBF depende de distância euclidiana e o kernel linear é afetado pela magnitude relativa dos coeficientes penalizados. Sem escalonar, features de maior amplitude dominam. É um dos erros mais comuns com SVM.

---

**🟡 Quando você usaria regressão logística em vez de gradient boosting?**

**Resposta modelo:** Vários cenários concretos.

**Quando interpretabilidade é requisito, não preferência** — crédito, seguros, saúde, contextos com exigência regulatória de explicar decisões individualmente. Coeficientes como razões de chances são auditáveis de um jeito que SHAP não é.

**Quando os dados são poucos** — com centenas de exemplos, um modelo linear regularizado generaliza melhor e é muito mais estável.

**Quando preciso de probabilidades bem calibradas** — a logística é calibrada por construção porque a log-loss é uma proper scoring rule.

**Quando a relação é aproximadamente linear** — se a logística já captura o sinal, o boosting não vai adicionar quase nada e custa muito mais.

**Quando latência e simplicidade operacional importam** — a inferência é um produto escalar; o modelo é um vetor de coeficientes, versionável, auditável e trivial de servir em qualquer stack.

E, sempre: **como baseline obrigatório**. Se meu boosting supera a logística em 1 ponto de AUC, o modelo certo para produzir é quase sempre a logística, porque a diferença não paga a complexidade operacional. Não conhecer esse número é não saber se a complexidade se justifica.

---

**🔴 Por que redes neurais raramente superam gradient boosting em dados tabulares?**

**Resposta modelo:** Algumas razões que se somam.

**Ausência de estrutura para explorar.** O sucesso de redes profundas vem de vieses indutivos alinhados à estrutura dos dados: convolução assume localidade e invariância a translação, atenção assume relações contextuais entre tokens. Dados tabulares não têm estrutura espacial nem sequencial; a ordem das colunas é arbitrária. Uma MLP tem viés indutivo fraco e precisa aprender tudo dos dados.

**Heterogeneidade das features.** Tabular mistura escalas, tipos, categóricas de alta cardinalidade, distribuições assimétricas e muitos missing. Árvores lidam com isso nativamente e são invariantes a transformações monótonas; redes exigem normalização cuidadosa e sofrem com features de cauda pesada.

**Fronteiras irregulares e não-suaves.** Redes têm viés para funções suaves; tabular frequentemente tem descontinuidades reais (regras de negócio, faixas de preço, limiares regulatórios), que árvores modelam com um split e redes aproximam mal.

**Regime de dados.** A maioria dos problemas tabulares tem milhares a milhões de linhas, não bilhões. Redes precisam de muito mais dados para compensar o viés indutivo fraco.

**Custo de tuning.** Boosting funciona bem perto do default; redes exigem escolhas de arquitetura, otimizador, schedule e normalização, então na prática comparações justas por orçamento de tuning favorecem boosting.

**A nuance honesta:** em datasets tabulares muito grandes, com muitas categóricas de alta cardinalidade, ou quando é preciso integrar tabular com texto/imagem num único modelo, arquiteturas neurais competem e às vezes vencem. Mas para o caso tabular puro e mediano, boosting continua sendo o padrão razoável, e isso é consistente com o que benchmarks independentes vêm mostrando.

---

**🔴 Como você interpreta um modelo de gradient boosting?**

**Resposta modelo:** Em camadas, e a chave é saber o que cada ferramenta responde e o que ela não responde.

**Importância de features nativa** — cuidado, é ambígua e frequentemente enganosa. "Gain" (redução total de perda atribuída à feature) é a mais defensável; "split count" enviesa para features de alta cardinalidade, porque elas oferecem mais pontos de corte possíveis; "cover" é raramente útil. Nenhuma delas indica **direção** do efeito, e todas dividem crédito arbitrariamente entre features correlacionadas.

**Permutation importance** — embaralha uma feature e mede a queda na métrica de validação. Vantagem: mede impacto no desempenho real, não na estrutura interna. Desvantagem: com features correlacionadas, embaralhar uma cria pontos impossíveis no espaço de features e subestima a importância de ambas (o modelo compensa com a correlacionada).

**SHAP** — a ferramenta principal. Atribui a cada feature a contribuição para a predição **daquele exemplo**, com garantias teóricas de aditividade e consistência derivadas de valores de Shapley. Dá tanto explicação local (por que este cliente foi negado) quanto global (agregando magnitudes). O TreeSHAP é exato e rápido em modelos de árvore.

**PDP e ICE** — mostram o efeito marginal de uma feature no intervalo de valores. PDP é a média (e pode esconder heterogeneidade: se metade dos casos sobe e metade desce, a média é plana); ICE mostra curvas individuais e revela essa heterogeneidade.

**O caveat que eu enunciaria explicitamente:** tudo isso é **associação, não causalidade**. SHAP explica o que o modelo faz, não o que aconteceria se você intervisse no mundo. Se alguém pergunta "então se eu aumentar essa variável, o resultado muda?", a resposta é que o modelo não responde isso — precisa de desenho causal. Confundir explicabilidade de modelo com inferência causal é um erro caro e comum em contextos de negócio.

---

**🔴 Naive Bayes assume independência entre features, o que é quase sempre falso. Por que ainda funciona?**

**Resposta modelo:** Porque classificação só precisa que a **ordenação** entre as classes esteja correta, não que as probabilidades estejam corretas. A violação da independência faz o modelo contar evidência correlacionada múltiplas vezes — se "nova" e "york" aparecem juntas, ele trata como duas evidências independentes — o que empurra as probabilidades para os extremos 0 e 1. Mas esse efeito frequentemente atinge todas as classes de forma parecida e preserva qual é a maior.

Ou seja: **Naive Bayes é um classificador razoável e um estimador de probabilidade ruim.** Se eu preciso da classe, ele pode servir; se eu preciso do valor da probabilidade para uma conta a jusante, ele é inadequado sem recalibração.

Há também um efeito de regularização: a suposição forte reduz drasticamente o número de parâmetros a estimar, o que ajuda muito com poucos dados. Com muitos dados, modelos que aprendem as dependências superam ele consistentemente.

**Follow-up:** *"Por que suavização de Laplace?"* — Sem ela, uma palavra nunca vista naquela classe dá probabilidade condicional zero, e como o modelo multiplica, um único termo zera a classe inteira. Somar uma constante a todas as contagens evita esse veto. E na implementação se trabalha em log, somando log-probabilidades, porque multiplicar milhares de números pequenos causa underflow.

---

**🔴 Você tem 10 milhões de linhas e 500 features tabulares, prevendo uma classe rara (0,5%). Qual modelo e por quê?**

**Resposta modelo:** Começaria por **LightGBM**, pelo tamanho — o splitting por histogramas e o crescimento leaf-wise foram feitos para esse regime — e com **regressão logística regularizada como baseline** para saber quanto a complexidade está de fato comprando.

Decisões específicas para este cenário:

**Sobre a raridade:** 0,5% de 10 milhões são 50 mil positivos, o que é bastante em termos absolutos. Então eu **não começaria reamostrando**. Usaria `scale_pos_weight` ou nada, com PR-AUC como métrica e o limiar definido pela capacidade operacional real. Undersampling da majoritária eu consideraria como otimização de custo de treino, não como remédio estatístico — e se usasse, recalibraria os scores depois.

**Sobre 500 features:** verificaria redundância e, mais importante, **disponibilidade em tempo de inferência** — features que existem no warehouse mas não em tempo real são leakage disfarçado. Boosting tolera features irrelevantes razoavelmente bem, então eu não faria seleção agressiva antes de ter um baseline; usaria permutation importance ou SHAP para podar depois, com olho no custo de manter cada feature em produção.

**Sobre validação:** se há componente temporal — e com esse volume quase certamente há — split temporal com gap, não k-fold aleatório. Com 10 milhões de linhas, um holdout único é grande o bastante para ser preciso, então eu não pagaria o custo de CV completa.

**Sobre o objetivo:** confirmaria com o negócio o que se faz com a predição. Se o output alimenta uma fila de revisão humana com capacidade fixa, a métrica é precision@k naquele k, e possivelmente ponderada por valor — pegar as fraudes caras importa mais que pegar muitas fraudes baratas. Isso pode mudar até a formulação, de classificação para regressão sobre perda esperada.

---

## 3. Armadilhas comuns

**Dizer que os coeficientes da logística são mudanças em probabilidade.** São em log-odds; `exp(w)` é razão de chances.

**Escalonar para árvores, não escalonar para SVM/kNN.** Exatamente ao contrário do necessário. Árvores são invariantes à escala; SVM e kNN dependem de distância e quebram sem escalonamento.

**Achar que random forest é só "várias árvores".** A amostragem de features em cada split é o mecanismo essencial; sem descorrelação, a média não reduz variância.

**Dizer que boosting não overfitta.** Overfitta com árvores demais. Early stopping é obrigatório.

**Achar que gradient boosting só funciona com MSE.** Funciona com qualquer perda diferenciável — é o ponto da formulação por gradiente.

**Esquecer que árvores não extrapolam.** Fatal em séries com tendência: o modelo nunca prevê acima do máximo visto no treino.

**Confundir importância de features com causalidade.** SHAP e importâncias explicam o modelo, não o mundo.

**Usar split count como importância.** Enviesa para features de alta cardinalidade.

**Usar SVM em dataset grande.** O(n²–n³) torna inviável.

**Achar que as probabilidades do Naive Bayes são confiáveis.** São sistematicamente extremas por conta da violação de independência.

**Não rodar um baseline linear.** Sem ele você não sabe quanto sua complexidade comprou, e essa é a primeira pergunta de qualquer entrevistador experiente.

**Escolher biblioteca por preferência pessoal e defendê-la com fervor.** A resposta madura é que a diferença entre XGBoost, LightGBM e CatBoost é pequena e a decisão é empírica.

**Deixar `n_estimators` fixo sem early stopping.** É o hiperparâmetro que menos deveria ser chutado, porque a validação define ele diretamente.
