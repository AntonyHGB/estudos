# 09 — Aprendizado Não-Supervisionado

> Clustering (k-means, DBSCAN, hierárquico), avaliação de clusters, redução de dimensionalidade não-linear, detecção de anomalias.
> Menos cobrado que os anteriores, mas aparece com força em vagas com segmentação de clientes, detecção de fraude/anomalia e análise exploratória. A pergunta que separa candidatos é sempre sobre **avaliação**, porque não há rótulo.

---

## 1. Resumo conceitual

### 1.1 O problema estrutural

Sem rótulos, **não existe critério objetivo de acerto**. O algoritmo otimiza um critério interno (compacidade, densidade, verossimilhança) que é uma *proxy* do que você quer. Consequências que precisam estar na ponta da língua:

- **Não há validação limpa.** Métricas internas medem se o resultado é consistente com o critério do algoritmo, o que é parcialmente circular.
- **O resultado depende de escolhas suas** — número de clusters, métrica de distância, escala das features — e essas escolhas não são deriváveis dos dados.
- **A validação real é externa:** o resultado é útil para a decisão de negócio? Ele é estável? Ele se correlaciona com algo que você sabe ser verdadeiro?

Isso não torna clustering inútil — torna a **formulação da pergunta** parte do trabalho, não uma etapa anterior a ele.

### 1.2 k-means

**Algoritmo (Lloyd):** escolher k centroides, repetir até convergir — (1) atribuir cada ponto ao centroide mais próximo, (2) recalcular cada centroide como a média dos pontos atribuídos.

**O que ele otimiza:** a soma das distâncias quadráticas intra-cluster (inércia / WCSS). O problema é NP-difícil em geral; o algoritmo de Lloyd é uma heurística que converge para um **mínimo local**, e o resultado depende da inicialização — daí **k-means++**, que escolhe centroides iniciais espalhados com probabilidade proporcional à distância quadrática aos já escolhidos, e daí rodar múltiplas inicializações e ficar com a de menor inércia.

**Suposições implícitas — este é o núcleo da pergunta:**

1. **Clusters aproximadamente esféricos e de tamanhos similares em extensão.** Porque a atribuição por distância euclidiana ao centroide produz fronteiras que são hiperplanos equidistantes (um diagrama de Voronoi), o que só descreve bem regiões isotrópicas.
2. **Densidades e cardinalidades parecidas.** Minimizar a soma de quadrados favorece clusters de tamanho similar, e um cluster grande tende a ser dividido enquanto um pequeno e distante é absorvido.
3. **Variáveis contínuas com distância euclidiana significativa.**
4. **k conhecido.**
5. **Todo ponto pertence a algum cluster** — não há conceito de ruído.

**Fraquezas:** sensível a outliers (a média é sensível a outliers, e um ponto extremo desloca o centroide); sensível à escala das features (**padronizar é obrigatório**); falha em clusters alongados, aninhados ou de formatos arbitrários; e sofre com a maldição da dimensionalidade, porque a noção de "mais próximo" degrada.

**Variantes:** k-medoids/PAM (usa pontos reais como centros, robusto a outliers, aceita qualquer métrica de distância), k-modes (categóricas), MiniBatch k-means (escala), GMM (ver adiante).

**Escolha de k:**

- **Método do cotovelo** — plotar inércia vs k e procurar a inflexão. Frequentemente ambíguo, porque a curva costuma ser suave e o "cotovelo" fica no olho de quem vê.
- **Silhouette score** — mede quão mais próximo um ponto está do próprio cluster do que do cluster vizinho mais próximo. Varia de -1 a 1. Melhor que o cotovelo, mas tem viés a favor de clusters convexos e compactos, o que é exatamente a suposição do k-means — ou seja, é parcialmente circular.
- **Gap statistic** — compara a inércia com a esperada sob uma distribuição de referência sem estrutura. Mais principiado, mais caro.
- **BIC/AIC** — aplicáveis quando você usa GMM, que é um modelo probabilístico de verdade.
- **O melhor critério, quase sempre: utilidade a jusante.** Os clusters são acionáveis? São interpretáveis pelo time de negócio? São estáveis sob reamostragem? Um k que produz 7 segmentos que o marketing não sabe usar é pior que um k que produz 4 que eles sabem.

### 1.3 GMM (Gaussian Mixture Models)

Modela os dados como uma mistura de k gaussianas, com médias, **matrizes de covariância** e pesos de mistura. Ajustado por **EM (Expectation-Maximization)**: alterna entre estimar a probabilidade de cada ponto pertencer a cada componente (E-step) e reestimar os parâmetros das gaussianas (M-step).

**Vantagens sobre k-means:**

- **Atribuição suave** — cada ponto tem uma probabilidade de pertencer a cada cluster, em vez de uma atribuição dura. Isso é informação útil (permite identificar pontos ambíguos na fronteira).
- **Clusters elípticos e de orientações diferentes**, porque a covariância é aprendida. k-means só consegue esferas.
- **É um modelo generativo de densidade**, então admite verossimilhança, BIC/AIC para escolher k, e amostragem.

**Relação com k-means:** k-means é essencialmente o caso limite do GMM com covariâncias esféricas iguais e atribuição dura. Dizer isso conecta os dois conceitos com elegância.

**Custo:** mais parâmetros (a covariância completa tem `O(d²)` por componente, o que fica proibitivo em alta dimensão — daí as variantes com covariância diagonal ou compartilhada), mais lento, e ainda dependente de inicialização.

### 1.4 DBSCAN

**Ideia:** clusters são **regiões densas separadas por regiões esparsas**. Dois parâmetros: `ε` (raio da vizinhança) e `minPts` (mínimo de pontos para uma vizinhança ser considerada densa).

Classifica pontos em: **core** (tem ≥ minPts na vizinhança ε), **border** (está na vizinhança de um core mas não é core) e **noise** (nenhum dos dois). Clusters são componentes conectados de pontos core, mais seus borders.

**Vantagens decisivas sobre k-means:**

- **Não precisa de k** — o número de clusters emerge da estrutura.
- **Encontra formatos arbitrários** — luas, espirais, anéis. É o exemplo canônico onde k-means falha completamente.
- **Identifica ruído explicitamente**, o que é uma vantagem conceitual grande: nem todo ponto pertence a um cluster, e forçar isso é uma distorção.
- Robusto a outliers, porque eles viram ruído em vez de deslocar centroides.

**Fraquezas:**

- **Sensível a `ε`**, que é difícil de escolher. Heurística padrão: plotar a distância ao k-ésimo vizinho de cada ponto, ordenar, e procurar o "joelho".
- **Falha com densidades variáveis** — um único `ε` não serve para uma região densa e outra esparsa ao mesmo tempo. Ou o cluster esparso vira ruído, ou os densos se fundem. **HDBSCAN** resolve isso construindo uma hierarquia sobre densidades variáveis e extraindo os clusters mais estáveis; é o que eu recomendaria hoje na maioria dos casos.
- **Degrada em alta dimensão**, porque densidade é ainda mais afetada pela maldição da dimensionalidade que distância.
- Não produz um modelo que atribua novos pontos naturalmente (diferente de k-means, onde basta achar o centroide mais próximo).

### 1.5 Clustering hierárquico

Constrói uma **árvore (dendrograma)** de agrupamentos aninhados.

**Aglomerativo (bottom-up)** — cada ponto começa como um cluster e os mais próximos são fundidos iterativamente. É o mais usado. **Divisivo (top-down)** — começa com tudo junto e divide.

**Linkage** (como medir distância entre clusters) — e isso muda drasticamente o resultado:

- **Single** (mínima distância entre pontos) — captura formatos alongados, mas sofre de *chaining*: uma cadeia fina de pontos funde dois clusters distintos.
- **Complete** (máxima) — favorece clusters compactos e de diâmetro similar; sensível a outliers.
- **Average** — compromisso.
- **Ward** — funde o par que minimiza o aumento da variância intra-cluster. É o padrão na prática e tende a produzir clusters de tamanhos parecidos; conceitualmente aparentado ao critério do k-means.

**Vantagens:** não precisa de k a priori (você corta o dendrograma na altura desejada, depois de ver a estrutura), o dendrograma é uma **visualização interpretável** da estrutura de similaridade, e aceita qualquer métrica de distância — inclusive matrizes de distância customizadas onde não há espaço vetorial.

**Fraqueza fatal para escala:** `O(n²)` de memória e entre `O(n²log n)` e `O(n³)` de tempo. Inviável acima de dezenas de milhares de pontos. Também é **guloso e irreversível**: uma fusão errada no início nunca é desfeita.

### 1.6 Avaliação de clusters

**Métricas internas** (sem rótulos):

- **Silhouette** — `(b - a)/max(a,b)`, onde `a` é a distância média intra-cluster e `b` a distância média ao cluster vizinho mais próximo. Interpretável (perto de 1 é bom, perto de 0 é fronteira, negativo indica ponto no cluster errado), mas favorece clusters convexos.
- **Davies-Bouldin** — razão entre dispersão intra e separação inter. Menor é melhor.
- **Calinski-Harabasz** — razão entre variância inter e intra. Maior é melhor. Tende a crescer com k.

Todas compartilham a mesma limitação: **premiam a geometria que o próprio algoritmo otimiza**, então usar silhouette para escolher k no k-means é parcialmente circular — você está medindo o quanto o resultado se parece com o que o k-means tenta produzir.

**Métricas externas** (quando existem rótulos de referência, tipicamente num experimento controlado): **Adjusted Rand Index** e **Normalized Mutual Information**, ambas invariantes a permutação de rótulos, e o ARI corrigido para concordância por acaso.

**Estabilidade** — o critério mais informativo e o mais subutilizado: reamostre os dados (bootstrap) ou perturbe levemente, refaça o clustering, e meça o quanto as atribuições concordam. **Uma solução instável não deve ser interpretada substantivamente**, mesmo com silhouette alto. Citar estabilidade como critério é um sinal forte de maturidade.

**Validação a jusante** — o critério que decide na prática: os clusters se correlacionam com variáveis que você não usou no clustering (receita, retenção, comportamento futuro)? Eles são acionáveis? O time de negócio consegue nomear e usar cada segmento?

### 1.7 Redução de dimensionalidade não-linear

**PCA** (ver [05](05-features-e-dimensionalidade.md)) só captura estrutura linear.

**t-SNE** — preserva **estrutura local**: converte distâncias em probabilidades de vizinhança e minimiza a divergência KL entre essas distribuições no espaço original e no reduzido. Excelente para revelar agrupamentos visualmente.

**Advertências obrigatórias sobre t-SNE**, e elas caem:

- **É só para visualização, não para pré-processamento.** Não há transformação paramétrica que aplique a novos pontos.
- **As distâncias entre clusters no gráfico não são significativas.** Dois clusters "longe" no t-SNE não são necessariamente mais diferentes que dois "perto". Só a vizinhança local é confiável.
- **Os tamanhos dos clusters não são significativos.** O algoritmo expande regiões densas e comprime esparsas.
- **A perplexidade muda drasticamente o resultado** — sempre olhe múltiplos valores antes de concluir qualquer coisa.
- **É estocástico** — execuções diferentes produzem gráficos diferentes.
- Pode **criar aglomerados aparentes em dados sem estrutura**, o que é o risco real: você vê clusters em ruído.

**UMAP** — baseado em teoria de variedades e topologia. Mais rápido, **preserva melhor a estrutura global** que o t-SNE (embora ainda não perfeitamente), e é parametrizável, permitindo transformar novos pontos. Hoje é geralmente preferido. Mantém, porém, os mesmos cuidados interpretativos.

**Autoencoders** — rede que comprime a entrada num gargalo e reconstrói. O gargalo é a representação reduzida. Aprende estrutura não-linear, escala bem, e é aplicável a novos pontos. Variantes: denoising (reconstruir a partir de entrada corrompida, forçando representações robustas), esparso, e **VAE** (variacional, que aprende uma distribuição latente e é generativo). Ponto conceitual bonito: um autoencoder linear com perda quadrática aprende o mesmo subespaço que o PCA.

### 1.8 Detecção de anomalias

**Três regimes, e escolher o certo é a primeira pergunta:**

- **Supervisionado** — você tem exemplos rotulados de anomalias. Aí é classificação desbalanceada, não detecção de anomalia. Prefira essa via quando possível: rótulos valem muito.
- **Semi-supervisionado (one-class)** — você tem apenas exemplos normais. Modela-se a normalidade e sinaliza desvios. É o regime mais comum em detecção de falhas.
- **Não-supervisionado** — dados não rotulados e mistos, assumindo que anomalias são raras e diferentes.

**Métodos:**

- **Estatísticos** — z-score, IQR, modelagem paramétrica. Simples, interpretável, e ainda o baseline correto em dados univariados ou de baixa dimensão. Falha em anomalias multivariadas (um ponto pode ser normal em cada variável isoladamente e anômalo na combinação — a distância de Mahalanobis captura isso considerando a covariância).
- **Isolation Forest** — a inversão conceitual que vale explicar: em vez de modelar a normalidade, ele **isola** pontos com partições aleatórias. Anomalias, por serem raras e diferentes, são isoladas com **menos** partições, portanto ficam mais perto da raiz. O score é o comprimento médio do caminho. Rápido, escala bem, poucos hiperparâmetros — é um default muito razoável.
- **LOF (Local Outlier Factor)** — compara a densidade local de um ponto com a dos seus vizinhos. Captura anomalias **locais**: um ponto que seria normal numa região esparsa é anômalo dentro de uma região densa. É a vantagem sobre métodos globais.
- **One-Class SVM** — aprende uma fronteira que envolve os dados normais. Sensível a hiperparâmetros e escala mal.
- **Autoencoder** — treinar para reconstruir dados normais; **erro de reconstrução alto** sinaliza anomalia. Bom em alta dimensão e em dados estruturados (imagem, sinal). Cuidado: autoencoders com capacidade excessiva aprendem a reconstruir bem até as anomalias.
- **Baseado em previsão** (séries temporais) — prever o próximo valor e sinalizar quando o resíduo excede o esperado. Naturalmente lida com sazonalidade e tendência.

**Os problemas práticos que decidem o sucesso**, e são o que um entrevistador experiente vai perguntar:

1. **Definir o que é anomalia.** Ponto isolado? Mudança de padrão contextual (100 acessos é normal às 14h e anômalo às 3h)? Sequência anômala de eventos individualmente normais? Cada um pede um método diferente.
2. **Escolher o limiar sem rótulos.** Na prática se define pela **capacidade operacional**: quantos alertas a equipe consegue investigar por dia. Isso transforma um problema estatístico mal-posto numa decisão bem-posta.
3. **Avaliar.** Sem rótulos, avalia-se por revisão humana de uma amostra dos alertas, por injeção de anomalias sintéticas conhecidas, e pela taxa de falsos positivos reportada pela operação.
4. **Fadiga de alerta.** Um sistema com precision baixa é desligado pelos operadores, e aí a métrica offline é irrelevante. Esse é o modo de falha mais comum em produção.
5. **Drift.** A definição de "normal" muda. Requer atualização periódica da linha de base, com o cuidado de não incorporar as próprias anomalias ao normal.

---

## 2. Perguntas de entrevista

---

**🟢 Como o k-means funciona?**

**Resposta modelo:** Escolhe k centroides iniciais e alterna duas etapas até convergir: atribui cada ponto ao centroide mais próximo, e recalcula cada centroide como a média dos pontos atribuídos a ele. O que ele minimiza é a soma das distâncias quadráticas dos pontos aos seus centroides.

Dois pontos importantes. Ele converge para um **mínimo local**, e o resultado depende da inicialização — por isso se usa k-means++, que escolhe centroides iniciais espalhados, e se roda múltiplas inicializações mantendo a de menor inércia. E **padronizar as features é obrigatório**, porque a distância euclidiana é dominada pela feature de maior amplitude numérica.

**Follow-up:** *"Como escolhe k?"* — Cotovelo na curva de inércia, que costuma ser ambíguo porque a curva é suave; silhouette, que é melhor mas favorece clusters convexos e compactos, que é exatamente o que o k-means produz, então é parcialmente circular; gap statistic, mais principiado e mais caro. Na prática o critério que eu privilegiaria é **utilidade a jusante e estabilidade**: os clusters são interpretáveis e acionáveis pelo negócio, e eles se mantêm quando eu reamostro os dados?

---

**🟡 Quando k-means falha? O que você usaria no lugar?**

**Resposta modelo:** k-means assume clusters aproximadamente esféricos, de extensões e densidades parecidas, com distância euclidiana significativa, e k conhecido. Ele falha sempre que essas suposições quebram.

**Formatos não-convexos** — luas, espirais, anéis. A atribuição por proximidade ao centroide produz fronteiras que são hiperplanos, então ele corta um formato alongado no meio. Aqui eu usaria **DBSCAN ou HDBSCAN**, que definem clusters por densidade e encontram formatos arbitrários.

**Clusters de tamanhos ou densidades muito diferentes** — minimizar soma de quadrados divide um cluster grande e absorve um pequeno. GMM lida melhor, porque aprende a covariância de cada componente.

**Clusters elípticos ou com orientações diferentes** — **GMM**, pela mesma razão.

**Presença de outliers** — a média é sensível a outliers, então um ponto extremo desloca o centroide. k-medoids é robusto porque usa pontos reais como centros, e DBSCAN classifica outliers como ruído explicitamente.

**Features categóricas** — a média não faz sentido. k-modes, ou clustering hierárquico com uma distância apropriada como Gower.

**Alta dimensão** — a distância perde significado. Reduzir dimensionalidade antes, ou usar métodos que não dependem tanto de distância global.

**Follow-up:** *"E se eu não sei quantos clusters existem?"* — DBSCAN e HDBSCAN determinam o número pela estrutura de densidade; clustering hierárquico permite ver o dendrograma inteiro e decidir onde cortar depois de observar a estrutura; e com GMM dá para usar BIC, que é um critério principiado porque o GMM é um modelo probabilístico de verdade.

---

**🟡 Explique DBSCAN e suas limitações.**

**Resposta modelo:** DBSCAN define clusters como regiões densas separadas por regiões esparsas. Dois parâmetros: um raio ε e um número mínimo de pontos. Um ponto é core se tem ao menos minPts dentro do raio ε; clusters são componentes conectados de pontos core, mais os pontos de fronteira alcançáveis; o resto é ruído.

As vantagens sobre k-means são substantivas: não precisa de k, encontra formatos arbitrários, e — o que eu considero conceitualmente mais importante — **identifica ruído explicitamente**. Nem todo ponto pertence a um cluster, e forçar isso, como k-means faz, é uma distorção.

As limitações: é sensível a ε, que é difícil de escolher — a heurística padrão é plotar a distância ao k-ésimo vizinho ordenada e procurar o joelho. **Falha com densidades variáveis**, porque um único ε não serve para uma região densa e uma esparsa simultaneamente; ou o cluster esparso vira ruído, ou os densos se fundem. HDBSCAN resolve isso construindo uma hierarquia sobre densidades variáveis e extraindo os clusters mais estáveis, e é o que eu usaria hoje na maior parte dos casos. Além disso degrada em alta dimensão, e não gera naturalmente um modelo para atribuir pontos novos.

---

**🟡 Como você avalia um resultado de clustering se não tem rótulos?**

**Resposta modelo:** Em quatro camadas, e eu não confiaria em nenhuma isolada.

**Métricas internas** — silhouette, Davies-Bouldin, Calinski-Harabasz. Úteis para comparar configurações, com a ressalva importante de que elas **premiam a geometria que o algoritmo otimiza**: usar silhouette para escolher k no k-means é parcialmente circular, porque estou medindo o quanto o resultado se parece com o que o k-means tenta produzir.

**Estabilidade** — e essa é a que eu mais valorizo e a mais esquecida. Reamostro os dados, refaço o clustering, e meço concordância entre as atribuições. Se a solução muda substancialmente com uma reamostragem, ela é ruído e não deve ser interpretada substantivamente, por melhor que seja a silhouette.

**Validação externa por variáveis não usadas** — os clusters se correlacionam com receita, retenção, ou comportamento futuro que eu **não** usei no clustering? Se sim, eles capturaram estrutura real.

**Utilidade a jusante** — que é o critério que decide. Os segmentos são interpretáveis? O time consegue nomear cada um e desenhar uma ação diferente para cada um? Um clustering matematicamente ótimo que produz sete segmentos indistinguíveis na prática é pior que um com quatro que geram campanhas diferentes.

Se houver oportunidade, o teste definitivo é um experimento: tratar segmentos diferentemente e medir se o efeito difere.

---

**🟡 Como você detectaria anomalias sem rótulos?**

**Resposta modelo:** Antes do método, eu definiria **o que conta como anomalia**, porque isso muda tudo. Um ponto isolado no espaço de features? Uma anomalia contextual, como 100 acessos que são normais às 14h e anômalos às 3h? Uma sequência anômala de eventos individualmente normais? Cada uma pede uma abordagem diferente, e pular essa etapa é o erro mais comum.

Sobre os métodos: **Isolation Forest** como default, porque é rápido, escala bem, tem poucos hiperparâmetros, e tem uma lógica elegante — em vez de modelar a normalidade, ele isola pontos com partições aleatórias, e anomalias, sendo raras e diferentes, são isoladas com menos partições. **LOF** quando as anomalias são locais, isto é, quando um ponto pode ser normal em termos globais mas anômalo em relação à sua vizinhança imediata. **Autoencoder** em alta dimensão ou dados estruturados, sinalizando erro de reconstrução alto — com o cuidado de que capacidade excessiva faz ele reconstruir bem até as anomalias. E métodos baseados em previsão em séries temporais, que lidam naturalmente com sazonalidade.

E eu manteria um **baseline estatístico simples** — z-score, IQR, ou distância de Mahalanobis se a estrutura é multivariada — porque ele é interpretável e surpreendentemente competitivo, e sem ele eu não sei se a complexidade se justificou.

**Follow-up crucial:** *"Como escolhe o limiar?"* — Sem rótulos não há como derivá-lo estatisticamente de forma satisfatória. Na prática eu o defino pela **capacidade operacional**: quantos alertas a equipe consegue investigar por dia. Isso transforma um problema mal-posto numa decisão bem-posta, e a métrica passa a ser precision no volume que eles processam. Depois eu construiria rótulos incrementalmente a partir do feedback dos analistas sobre os alertas investigados, o que com o tempo permite migrar para um modelo supervisionado — que é sempre melhor quando existe rótulo.

---

**🔴 t-SNE mostrou clusters bem separados. Você pode concluir que existem grupos distintos?**

**Resposta modelo:** Não sem verificação, e essa é uma armadilha real.

O t-SNE preserva estrutura **local** e distorce sistematicamente a global. Três consequências que impedem a conclusão direta: as **distâncias entre clusters no gráfico não são significativas** — dois grupos "longe" não são necessariamente mais diferentes que dois "perto"; os **tamanhos aparentes não são significativos**, porque o algoritmo expande regiões densas e comprime esparsas; e o resultado **muda drasticamente com a perplexidade** e com a semente aleatória.

Mais grave: o t-SNE pode **produzir aglomerados aparentes em dados sem nenhuma estrutura**, porque ele força a separação de vizinhanças. Ver clusters no gráfico é evidência fraca de que eles existem.

O que eu faria para verificar: rodar com **múltiplas perplexidades e múltiplas sementes** e ver se a estrutura persiste; comparar com **UMAP**, que preserva melhor a estrutura global; rodar um algoritmo de clustering **no espaço original**, não na projeção, e checar se as atribuições correspondem ao que o gráfico sugere; testar **estabilidade sob reamostragem**; e verificar se os grupos se separam em variáveis que não entraram na projeção. Só então eu afirmaria que existem grupos distintos.

---

**🔴 Você precisa segmentar clientes. Descreva sua abordagem completa.**

**Resposta modelo:** Eu começaria pelo objetivo, não pelo algoritmo, porque segmentação sem propósito produz clusters bonitos e inúteis. Segmentar **para quê** — campanhas de marketing diferenciadas, precificação, priorização de atendimento, desenvolvimento de produto? A resposta determina quais features entram e quantos segmentos fazem sentido, e frequentemente revela que o problema nem é clustering.

**Features.** Escolheria com base no objetivo, não jogando tudo. Para marketing, RFM (recência, frequência, valor monetário) continua sendo uma base extremamente forte e interpretável — vale começar por ela antes de qualquer coisa mais sofisticada. Além disso, comportamento de uso, mix de categorias, canal, tenure. Cuidado explícito com features correlacionadas, que pesam implicitamente a mesma dimensão várias vezes, e com features de escalas muito diferentes — padronização é obrigatória, e para variáveis monetárias tipicamente log antes, porque a distribuição é de cauda longa e sem transformação os poucos clientes gigantes dominam a geometria.

**Método.** k-means como baseline porque é interpretável e os centroides descrevem cada segmento diretamente em termos das features. GMM se eu quiser atribuição suave, que é útil aqui porque clientes na fronteira entre segmentos são reais e forçar uma atribuição dura perde informação. Hierárquico se a base for pequena e eu quiser ver a estrutura antes de decidir o número de segmentos. Se houver muitas features categóricas, k-modes ou uma distância de Gower.

**Escolha do número de segmentos.** Combinaria silhouette e estabilidade com uma restrição prática forte: o número de segmentos deve ser **operacionalizável**. Se o time consegue executar quatro estratégias distintas, dez segmentos são inúteis mesmo com métrica melhor.

**Validação.** Estabilidade sob bootstrap; separação em variáveis **não usadas** no clustering, como receita futura ou churn, que é a evidência mais convincente de que capturei algo real; e interpretabilidade — cada segmento precisa ter uma descrição que uma pessoa de negócio reconheça e consiga nomear.

**Operacionalização**, que é o que costuma faltar: preciso ser capaz de **atribuir clientes novos** a segmentos (k-means e GMM fazem isso naturalmente, DBSCAN não), preciso decidir com que frequência re-segmentar, e preciso lidar com **migração entre segmentos** — clientes mudam, e se o segmento muda toda semana a operação não consegue agir sobre ele. Costuma valer aplicar histerese ou revisar em ciclos fixos.

**E a alternativa que eu levantaria explicitamente:** se o objetivo é prever algo específico — quem vai dar churn, quem responde a uma oferta — um modelo **supervisionado** é quase sempre melhor que segmentar e tratar cada segmento. Segmentação é para entendimento e para operação diferenciada; predição é para predição. Confundir os dois é o erro mais caro deste tipo de projeto.

---

**🔴 Qual a diferença entre PCA, t-SNE, UMAP e autoencoders?**

**Resposta modelo:** Diferem em três eixos: linearidade, o que preservam, e se são aplicáveis a novos pontos.

**PCA** é linear, preserva a **variância global** por projeção ortogonal, é determinístico, rápido, e produz uma transformação que se aplica trivialmente a novos dados. Serve como pré-processamento real, não só visualização. Limitação: só captura estrutura linear.

**t-SNE** é não-linear e preserva **vizinhança local**, minimizando a divergência entre distribuições de vizinhança no espaço original e no reduzido. É excelente para visualização e péssimo para qualquer outra coisa: não tem transformação paramétrica para novos pontos, distorce distâncias e tamanhos globais, é estocástico, e é caro. Só para 2D e 3D.

**UMAP** também é não-linear e local, mas fundamentado em teoria de variedades. É bem mais rápido, **preserva melhor a estrutura global** que o t-SNE, e é parametrizável, o que permite transformar novos pontos. É geralmente o que eu escolheria hoje entre os dois, mantendo os mesmos cuidados interpretativos.

**Autoencoders** aprendem uma compressão não-linear treinando reconstrução através de um gargalo. Escalam bem, aplicam-se a novos dados, e a representação latente serve como feature real para tarefas a jusante. Custam treino e ajuste, e a representação não é interpretável. Ponto conceitual bonito: um autoencoder linear com perda quadrática recupera o mesmo subespaço do PCA.

A regra prática que eu daria: **PCA ou autoencoder para pré-processamento; UMAP ou t-SNE para olhar os dados** — e, ao olhar, sem tirar conclusões quantitativas do gráfico.

---

## 3. Armadilhas comuns

**Não padronizar antes de k-means, DBSCAN ou PCA.** Métodos baseados em distância são dominados pela feature de maior amplitude.

**Usar k-means em clusters não-esféricos.** As suposições geométricas são estruturais, não um detalhe de ajuste.

**Escolher k só pelo cotovelo.** A curva costuma ser suave e o cotovelo é subjetivo.

**Usar silhouette para validar k-means sem reconhecer a circularidade.** Ela premia exatamente a geometria que o k-means produz.

**Não testar estabilidade.** É o sinal mais informativo de que a estrutura é real, e é o mais ignorado.

**Interpretar distâncias e tamanhos num gráfico t-SNE.** Não são significativos.

**Concluir que existem grupos porque o t-SNE mostrou separação.** Ele pode criar aglomerados em ruído.

**Usar t-SNE como pré-processamento.** Não há transformação para novos pontos, e a projeção não preserva o que um modelo precisaria.

**Aplicar DBSCAN com densidades muito variáveis.** Use HDBSCAN.

**Fazer clustering hierárquico com centenas de milhares de pontos.** O custo quadrático de memória inviabiliza.

**Não definir o que é anomalia antes de escolher o método.** Anomalia pontual, contextual e coletiva pedem abordagens diferentes.

**Escolher limiar de anomalia sem considerar a capacidade operacional.** Um sistema que gera mais alertas do que se consegue investigar é desligado, e a métrica offline vira irrelevante.

**Fazer segmentação sem objetivo de negócio definido.** Produz clusters estatisticamente válidos e operacionalmente inúteis.

**Usar clustering quando o problema é supervisionado.** Se você quer prever algo específico e tem rótulos, preveja.
