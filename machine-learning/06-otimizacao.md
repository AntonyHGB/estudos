# 06 — Otimização

> Gradiente descendente e variantes, learning rate, funções de perda, convexidade.
> Tópico onde a pergunta parece matemática mas o que se avalia é intuição: por que Adam funciona, por que o learning rate é o hiperparâmetro mais importante, e por que a perda que você escolhe define o modelo que você obtém.

---

## 1. Resumo conceitual

### 1.1 A ideia central

Treinar um modelo é resolver `min_θ L(θ)`, onde `L` é a perda média sobre os dados. Como para modelos interessantes não há solução fechada, você desce iterativamente:

```
θ_{t+1} = θ_t - η ∇L(θ_t)
```

O gradiente aponta na direção de **maior crescimento** da função; o sinal negativo desce. `η` é o learning rate: o tamanho do passo.

Duas observações que valem a resposta inteira:

**O gradiente é informação puramente local.** Ele diz a direção de descida mais íngreme *naquele ponto*, com validade infinitesimal. Passos grandes extrapolam informação local para longe, o que é a razão de divergência com learning rate alto.

**A direção de descida mais íngreme não é a direção do mínimo.** Numa superfície alongada (mal-condicionada), o gradiente aponta perpendicularmente às curvas de nível, e isso faz o trajeto ziguezaguear atravessando o vale em vez de descer ao longo dele. Praticamente todos os aprimoramentos do gradiente descendente — momentum, Adam, batch norm, precondicionamento — existem para atacar esse problema.

### 1.2 Batch, Stochastic e Mini-batch

**Batch (full-batch) GD** — gradiente sobre todo o dataset por passo. Direção precisa, trajetória suave, mas cada passo custa uma passada completa nos dados. Inviável em escala e determinístico demais: fica preso em qualquer ponto crítico ruim que encontrar.

**SGD (estocástico)** — gradiente de **um** exemplo por passo. Muito barato por passo e muito ruidoso. O ruído tem um papel útil — ajuda a escapar de regiões ruins — mas a trajetória oscila muito e não aproveita paralelismo de hardware.

**Mini-batch** — o padrão universal. Gradiente sobre B exemplos (32 a 512 tipicamente, mas em treino distribuído de larga escala usam-se batches muito maiores). Compromisso: variância do gradiente cai com `1/B`, aproveita paralelismo de GPU, e mantém ruído suficiente para ser útil.

**O efeito do tamanho do batch, que é o que se pergunta:**

- **Batch pequeno** → gradiente ruidoso → mais atualizações por época → **efeito regularizador**. Existe evidência empírica consistente de que batches pequenos tendem a convergir para mínimos mais "planos", associados a melhor generalização (a intuição: um mínimo plano é robusto a pequenas perturbações dos parâmetros, e a diferença entre a superfície de perda de treino e de teste é aproximadamente uma perturbação).
- **Batch grande** → gradiente preciso → melhor uso de GPU → menos passos por época → tende a generalizar pior se você não ajustar nada. A mitigação padrão é **aumentar o learning rate junto com o batch** (as heurísticas comuns são escalar linearmente ou pela raiz quadrada) e usar **warmup**, porque no início do treino um learning rate alto com batch grande desestabiliza.

Ponto importante: **batch grande não é "melhor" nem "pior" — é um trade-off entre eficiência de hardware e regularização implícita.**

### 1.3 Momentum

Gradiente descendente puro trata cada passo independentemente. **Momentum** acumula uma média móvel dos gradientes:

```
v_{t+1} = β v_t + ∇L(θ_t)          (β ≈ 0.9)
θ_{t+1} = θ_t - η v_{t+1}
```

A analogia da bola descendo uma encosta com inércia é a que se espera na resposta, mas o mecanismo preciso é melhor: em direções onde o gradiente é **consistente** entre passos, as contribuições se somam e a velocidade cresce (aceleração ao longo do vale); em direções onde o gradiente **oscila de sinal**, as contribuições se cancelam (amortecimento do ziguezague transversal). É exatamente o remédio para o mal-condicionamento descrito em 1.1. O fator de aceleração efetivo é aproximadamente `1/(1-β)`, então β=0.9 acelera cerca de 10×.

**Nesterov (NAG)** — calcula o gradiente na posição *antecipada* `θ - ηβv` em vez da atual. A intuição: "olhar para onde a inércia vai me levar antes de decidir a correção". Isso produz uma correção mais informada e reduz o overshoot em torno do mínimo.

### 1.4 Learning rate adaptativo

**AdaGrad** — divide o learning rate de cada parâmetro pela raiz da soma acumulada dos gradientes ao quadrado daquele parâmetro. Parâmetros com gradientes historicamente grandes recebem passos menores; parâmetros raramente atualizados (features esparsas) recebem passos maiores. **Problema fatal:** a soma acumulada só cresce, então o learning rate efetivo decai monotonicamente até o treino parar prematuramente.

**RMSProp** — troca a soma acumulada por uma **média móvel exponencial** dos gradientes ao quadrado. Isso resolve o decaimento irreversível: a memória "esquece" gradientes antigos, e o learning rate efetivo pode voltar a subir se os gradientes recentes forem pequenos.

**Adam** — combina momentum (primeiro momento) com RMSProp (segundo momento):

```
m_t = β₁ m_{t-1} + (1-β₁) g_t              (média dos gradientes — direção)
v_t = β₂ v_{t-1} + (1-β₂) g_t²             (média dos quadrados — escala)
m̂_t = m_t/(1-β₁ᵗ),  v̂_t = v_t/(1-β₂ᵗ)     (correção de viés)
θ_{t+1} = θ_t - η · m̂_t / (√v̂_t + ε)
```

Defaults: `β₁=0.9, β₂=0.999, ε=1e-8`.

**A correção de viés existe porque `m` e `v` são inicializados em zero**, o que os enviesa para baixo nos primeiros passos — especialmente `v`, com `β₂=0.999`, cuja média móvel demora ~1000 passos para "esquentar". Sem a correção, os primeiros passos seriam desproporcionalmente grandes (dividindo por um `√v` artificialmente pequeno). Saber isso é um sinal claro de que você entende o algoritmo e não só o usa.

**AdamW** — a variante padrão hoje. A questão: em Adam, aplicar weight decay como termo L2 na perda faz o decay ser **dividido pelo `√v̂` adaptativo**, então parâmetros com gradientes grandes recebem menos decay — o que não é o comportamento pretendido e desacopla o efeito real do valor configurado. AdamW **desacopla** o weight decay, aplicando-o diretamente ao parâmetro, fora do mecanismo adaptativo. Na prática isso melhora generalização de forma consistente e AdamW é o default em treino de transformers.

**Adam vs SGD com momentum — a pergunta clássica.** Adam converge mais rápido, é muito menos sensível à escolha inicial do learning rate, e é a escolha padrão para transformers, RNNs e qualquer coisa com gradientes esparsos ou de escalas muito heterogêneas. Mas existe evidência empírica consistente de que **SGD com momentum e um schedule bem ajustado generaliza melhor em visão computacional**, especialmente CNNs em classificação de imagens. A explicação mais aceita envolve o viés implícito de cada método na escolha de mínimos. A resposta madura: **Adam como default por robustez e velocidade; SGD+momentum quando o domínio é visão, o orçamento de tuning existe, e o último ponto percentual importa.**

### 1.5 Learning rate — o hiperparâmetro mais importante

**Muito alto:** overshoot do mínimo, oscilação, ou divergência (perda vira NaN). Sintoma: perda que sobe, oscila violentamente, ou explode.
**Muito baixo:** convergência lentíssima, e maior chance de estacionar num ponto ruim porque o ruído não é suficiente para escapar.

**Schedules (redução ao longo do treino):**

- **Step decay** — dividir por um fator em épocas fixas. Simples e eficaz.
- **Exponencial** — `η_t = η₀ e^(-kt)`.
- **Cosine annealing** — decai suavemente seguindo meio cosseno até ~0. Hoje é o padrão em deep learning moderno.
- **ReduceLROnPlateau** — reduz quando a métrica de validação estagna. Adaptativo ao progresso real.
- **Warmup** — **subir** o learning rate linearmente nos primeiros passos antes de decair. É essencial em transformers e com batches grandes: no início, os parâmetros são aleatórios, as estimativas de segundo momento do Adam são pouco confiáveis, e um passo grande pode desestabilizar irreversivelmente. A combinação **warmup + cosine decay** é a receita padrão em 2026.
- **One-cycle** — sobe e desce dentro de um único ciclo, com learning rate máximo alto. Permite convergência rápida ("super-convergence").

**LR range test:** treinar poucas centenas de passos aumentando o learning rate exponencialmente e plotar perda vs. learning rate. O ponto pouco antes de a perda começar a subir é uma boa escolha de máximo. É uma resposta prática que impressiona porque mostra método em vez de chute.

### 1.6 Funções de perda

**A escolha da perda define o que "melhor modelo" significa.** É a mesma lógica das métricas — mas aqui é o que o otimizador de fato persegue.

**Regressão:**

- **MSE** — penaliza quadraticamente; sensível a outliers; estima a **média condicional**.
- **MAE** — penaliza linearmente; robusta; estima a **mediana condicional**. Gradiente constante em módulo, o que dificulta a convergência fina perto do mínimo.
- **Huber** — quadrática dentro de δ, linear fora. Robusta e diferenciável.
- **Quantílica (pinball)** — penaliza assimetricamente e estima um **quantil** específico. É a perda para previsão de intervalos e para casos com custo assimétrico (em previsão de demanda, faltar estoque costuma custar mais que sobrar).
- **Log-cosh** — suave, comportamento semelhante ao Huber.

**Classificação:**

- **Cross-entropy / log-loss** — o padrão. `-Σ y log(p)`. É a verossimilhança negativa, é uma *proper scoring rule* (é minimizada pela probabilidade verdadeira, o que induz calibração), e penaliza **fortemente** previsões confiantes e erradas: quando `p → 0` para a classe correta, a perda tende a infinito.
- **Hinge** — usada em SVM. `max(0, 1 - y·f(x))`. Zero para pontos corretamente classificados **além da margem**, o que produz esparsidade (só os vetores de suporte importam). Não produz probabilidades.
- **Focal loss** — cross-entropy multiplicada por `(1-p_t)^γ`, o que **reduz o peso de exemplos fáceis**. Criada para detecção de objetos, onde há desbalanceamento extremo entre background e objetos, e o volume de exemplos fáceis domina o gradiente. É a resposta certa quando o problema é "muitos negativos triviais afogando o sinal".
- **Label smoothing** — substituir alvos de 1.0 por 0.9 (e 0 por ε/K). Impede que o modelo persiga logits infinitos, melhora calibração e age como regularizador.

**Contrastiva / triplet / InfoNCE** — para aprendizado de representações: aproxima pares similares e afasta dissimilares no espaço de embedding. É a base de embeddings modernos e de aprendizado auto-supervisionado. Ver [08](08-deep-learning-moderno.md).

**Uma observação de alto valor:** a perda que você otimiza frequentemente **não é** a métrica que o negócio quer, porque a métrica de negócio costuma ser não-diferenciável (acurácia, F1, NDCG, receita). Você otimiza um substituto diferenciável e monitora a métrica real. Reconhecer explicitamente essa lacuna — e discutir como reduzi-la (pesos por classe, perdas customizadas, ajuste de limiar pós-treino, aprendizado sensível a custo) — é uma resposta de nível sênior.

### 1.7 Convexidade

Uma função é **convexa** se o segmento entre dois pontos quaisquer do gráfico fica acima da função. Consequência decisiva: **todo mínimo local é global**, e o gradiente descendente com learning rate apropriado converge para a solução ótima independentemente da inicialização.

**Convexas:** regressão linear com MSE, regressão logística com log-loss, SVM com hinge, Lasso e Ridge. Por isso esses modelos são reprodutíveis, não dependem de inicialização, e têm garantias de convergência.

**Não-convexas:** essencialmente todas as redes neurais, por causa das composições de não-linearidades. Aqui não há garantia de mínimo global, e o resultado depende de inicialização e da trajetória.

**A pergunta 🔴 que decorre disso: por que redes funcionam apesar de não-convexidade?** A resposta atual, que combina teoria e evidência empírica:

1. **Em alta dimensão, os pontos críticos problemáticos são majoritariamente pontos de sela, não mínimos locais ruins.** Para um ponto crítico ser mínimo local, todas as milhões de direções da Hessiana precisam ter curvatura positiva; a probabilidade disso é minúscula. Selas são fugíveis, especialmente com o ruído do SGD e com momentum.
2. **A maioria dos mínimos locais em redes grandes tem valor de perda parecido.** Empiricamente, treinos com inicializações diferentes convergem para perdas similares — a paisagem tem muitos vales de qualidade equivalente, não um pico solitário de qualidade e milhões de armadilhas.
3. **Sobre-parametrização suaviza a paisagem** e cria variedades conexas de soluções que interpolam os dados.
4. **Não buscamos o mínimo global de treino — buscamos boa generalização.** O mínimo global do erro de treino é, com frequência, uma solução que decorou os dados. O ruído do SGD que impede a convergência exata é parte do que faz o método funcionar.

### 1.8 Diagnóstico da curva de perda

Pergunta prática frequente: "a perda está fazendo X, o que é?".

| Sintoma | Causa provável |
|---|---|
| Perda vira NaN / explode | Learning rate alto demais; gradientes explodindo; divisão por zero ou log(0) na perda; dados não normalizados |
| Perda oscila muito | Learning rate alto; batch pequeno demais |
| Perda cai e estaciona alto | Learning rate baixo demais; capacidade insuficiente; features fracas; morte de ReLUs |
| Perda de treino cai, validação sobe | Overfitting — early stopping, regularização |
| Perda não se move desde o início | Learning rate ~0; gradientes zerados (saturação, ReLUs mortas); bug (dados ou rótulos desconectados da perda) |
| Perda cai muito rápido e para | Modelo aprendeu a classe majoritária e nada mais |
| Perda de treino maior que a de validação | Normal com dropout/augmentation, que só agem no treino |
| Perda diminui em degraus | Schedule de learning rate agindo (esperado) |

**Teste de sanidade universal:** conseguir **overfittar deliberadamente um lote pequeno** (por exemplo 32 exemplos) até perda ≈ 0. Se não consegue, há bug — na perda, nos rótulos, no gradiente ou na arquitetura — e não adianta ajustar hiperparâmetros. É a primeira coisa que um engenheiro experiente faz, e citá-la vale muito.

---

## 2. Perguntas de entrevista

---

**🟢 Explique o gradiente descendente.**

**Resposta modelo:** É um método iterativo para minimizar uma função. Calcula-se o gradiente da perda em relação aos parâmetros — que aponta na direção de maior crescimento — e dá-se um passo na direção oposta, com tamanho controlado pelo learning rate. Repete-se até convergir.

Duas nuances que importam. Primeiro, o gradiente é informação **local**: ele é válido infinitesimalmente, e por isso passos grandes extrapolam para regiões onde a informação não vale mais, o que causa oscilação ou divergência. Segundo, a direção de descida mais íngreme **não** é a direção do mínimo: em superfícies alongadas o gradiente aponta transversalmente ao vale, e o trajeto ziguezagueia. Praticamente todas as melhorias sobre o método básico — momentum, Adam, normalização — existem para atacar esse problema.

**Follow-up:** *"Qual a diferença entre batch, stochastic e mini-batch?"* — Batch usa todos os dados por passo: direção precisa e caro. Estocástico usa um exemplo: barato e muito ruidoso. Mini-batch usa um subconjunto e é o padrão, porque a variância do gradiente cai com o tamanho do batch, aproveita paralelismo de GPU, e mantém ruído suficiente para ajudar a escapar de regiões ruins.

---

**🟢 O que acontece se o learning rate for muito alto? E muito baixo?**

**Resposta modelo:** Muito alto: o passo ultrapassa o mínimo, a perda oscila e pode divergir — na prática, aparece como perda subindo ou virando NaN. Muito baixo: converge lentamente, gasta orçamento de computação, e pode estacionar num ponto ruim porque não há energia suficiente para escapar.

Na prática eu não escolho um valor fixo: uso um schedule. O padrão hoje é warmup seguido de cosine annealing — subir o learning rate nos primeiros passos, porque no início os parâmetros são aleatórios e as estimativas do otimizador ainda não são confiáveis, e depois decair suavemente para permitir convergência fina. Para escolher o valor máximo eu faria um LR range test: treinar algumas centenas de passos aumentando o learning rate exponencialmente e escolher o ponto pouco antes de a perda começar a subir.

---

**🟡 Como o Adam funciona e por que ele é o default?**

**Resposta modelo:** Adam mantém duas médias móveis exponenciais por parâmetro: a dos gradientes (primeiro momento, que é essencialmente momentum e dá a direção) e a dos gradientes ao quadrado (segundo momento, que estima a escala típica do gradiente daquele parâmetro). A atualização divide o primeiro pelo raiz do segundo, o que normaliza o passo: parâmetros com gradientes historicamente grandes recebem passos menores, e vice-versa. O efeito é um **learning rate efetivo por parâmetro**.

Ele também aplica correção de viés, porque as duas médias começam em zero e ficam enviesadas para baixo nos primeiros passos — especialmente o segundo momento, cuja constante de tempo é longa. Sem a correção, os primeiros passos seriam desproporcionalmente grandes.

É o default porque é muito menos sensível à escolha do learning rate inicial, converge rápido, e lida bem com gradientes esparsos e com escalas muito heterogêneas entre camadas — que é exatamente a situação em transformers.

**Follow-up quase garantido:** *"Adam é sempre melhor que SGD?"* — Não. Existe evidência empírica consistente de que SGD com momentum e um schedule bem ajustado **generaliza melhor em visão computacional**, especialmente CNNs. A explicação mais aceita é sobre o viés implícito de cada otimizador na escolha do tipo de mínimo. A regra prática que eu usaria: Adam como default por robustez e velocidade, e SGD com momentum quando o domínio é visão, existe orçamento de tuning, e o último ponto percentual importa. Em NLP e transformers, AdamW é praticamente universal.

**Follow-up 🔴:** *"Por que AdamW e não Adam com L2?"* — Porque em Adam o termo L2 adicionado à perda vira gradiente e passa a ser dividido pelo denominador adaptativo. Isso faz parâmetros com gradientes grandes receberem menos decay, o que não é o comportamento pretendido e desacopla o efeito real do valor que você configurou. AdamW aplica o weight decay diretamente ao parâmetro, fora do mecanismo adaptativo. Na prática melhora generalização de forma consistente, e é por isso que virou o padrão em treino de transformers.

---

**🟡 O que é momentum e por que ele ajuda?**

**Resposta modelo:** Momentum acumula uma média móvel exponencial dos gradientes e usa essa velocidade acumulada para atualizar os parâmetros, em vez do gradiente instantâneo.

O mecanismo: em direções onde o gradiente é **consistente** entre passos, as contribuições se somam e a velocidade cresce — aceleração ao longo do vale. Em direções onde o gradiente **troca de sinal** a cada passo, as contribuições se cancelam — amortecimento do ziguezague. Isso ataca diretamente o problema de superfícies mal-condicionadas, onde a descida mais íngreme atravessa o vale em vez de percorrê-lo.

Com β = 0.9, o fator de aceleração efetivo é cerca de 10×, já que é aproximadamente `1/(1-β)`. A variante Nesterov calcula o gradiente na posição antecipada pela inércia, o que dá uma correção mais informada e reduz overshoot perto do mínimo.

---

**🟡 Como você escolhe a função de perda?**

**Resposta modelo:** A perda define o que o otimizador considera "melhor", então eu escolho a partir do que o problema realmente quer.

Em **regressão**, a pergunta é qual estatística eu quero: MSE estima a média condicional, MAE estima a mediana. Se há outliers e eu quero robustez, MAE ou Huber. Se o custo dos erros é assimétrico — e em previsão de demanda quase sempre é, porque faltar estoque costuma custar mais que sobrar — perda quantílica, que estima um quantil e penaliza os dois lados de forma diferente.

Em **classificação**, cross-entropy é o padrão porque é a verossimilhança negativa e é uma proper scoring rule, o que significa que ela é minimizada pela probabilidade verdadeira e portanto induz calibração. Se há desbalanceamento extremo com muitos negativos triviais, focal loss reduz o peso dos exemplos fáceis para que eles não dominem o gradiente. Label smoothing quando o modelo fica superconfiante.

E a observação que eu faria explicitamente: **a perda quase nunca é a métrica de negócio**, porque a métrica de negócio costuma ser não-diferenciável — acurácia, F1, NDCG, receita. Eu otimizo um substituto diferenciável e **monitoro a métrica real**, e trabalho para reduzir a lacuna com pesos por classe, perdas customizadas ou ajuste de limiar pós-treino.

**Follow-up:** *"Por que não usar MSE em classificação?"* — Duas razões. Estatisticamente, MSE não corresponde à verossimilhança de Bernoulli, então não é a perda principiada. E de otimização: MSE composta com a sigmoide é não-convexa e, pior, o gradiente carrega o fator da derivada da sigmoide, que satura perto de 0 e 1. Isso faz o aprendizado quase parar exatamente quando o modelo está confiante e errado — que é justamente quando ele mais precisaria de um sinal forte de correção. Com cross-entropy, o gradiente em relação aos logits é simplesmente `(p - y)`, e é proporcional ao erro.

---

**🟡 Sua perda de treino virou NaN. Como você depura?**

**Resposta modelo:** Na ordem de probabilidade.

**Learning rate alto demais** é a causa mais comum. Reduzo em 10× e vejo se estabiliza; se sim, era isso, e adiciono warmup.

**Gradientes explodindo**, típico em RNNs e redes profundas. Aplico gradient clipping por norma e monitoro a norma do gradiente ao longo do treino para confirmar.

**Instabilidade numérica na perda** — `log(0)` na cross-entropy, divisão por zero, raiz de negativo. A correção é usar as versões numericamente estáveis das funções (por exemplo, cross-entropy que recebe logits em vez de probabilidades, o que evita computar o log explicitamente).

**Dados problemáticos** — NaN ou infinito nas features, valores extremos não normalizados, ou um rótulo inválido. Verifico os dados antes de culpar o modelo.

**Bug na inicialização** — pesos inicializados com escala errada podem causar explosão nas primeiras camadas.

O procedimento que eu seguiria: registro em qual passo o NaN aparece, verifico as normas de gradiente por camada logo antes, e — se aparece no primeiro passo — o problema é quase certamente dados ou inicialização, não otimização.

E o teste de sanidade que eu faria antes de tudo: **conseguir overfittar um lote de 32 exemplos até perda perto de zero**. Se nem isso funciona, há um bug estrutural e não adianta ajustar hiperparâmetros.

---

**🟡 Como o tamanho do batch afeta o treinamento?**

**Resposta modelo:** Afeta três coisas ao mesmo tempo.

**Ruído do gradiente:** a variância cai proporcionalmente a `1/B`. Batch pequeno significa gradiente ruidoso, o que age como regularizador — existe evidência empírica consistente de que batches pequenos convergem para mínimos mais planos, associados a melhor generalização. A intuição é que um mínimo plano é robusto a perturbações dos parâmetros, e a diferença entre a superfície de perda de treino e de teste funciona como uma perturbação.

**Eficiência computacional:** batches grandes usam melhor a GPU, então cada época é mais rápida em tempo de relógio, mesmo com menos atualizações.

**Interação com o learning rate:** ao aumentar o batch, o gradiente fica menos ruidoso e você pode e deve aumentar o learning rate — as heurísticas comuns são escalar linearmente ou pela raiz do fator. Sem esse ajuste, batch grande costuma generalizar pior. E com batch grande, **warmup passa a ser importante**, porque um learning rate alto no início do treino, quando os parâmetros ainda são aleatórios, desestabiliza.

Ou seja: batch grande não é melhor nem pior, é um trade-off entre eficiência de hardware e regularização implícita, e ele precisa vir acompanhado de ajustes no learning rate.

---

**🔴 Por que redes neurais funcionam apesar de a otimização ser não-convexa?**

**Resposta modelo:** Quatro razões que se combinam.

**Os pontos críticos ruins em alta dimensão são majoritariamente selas, não mínimos locais.** Para um ponto crítico ser mínimo local, a Hessiana precisa ter curvatura positiva em **todas** as milhões de direções. A probabilidade disso é minúscula; o esperado é que algumas direções tenham curvatura negativa, o que caracteriza uma sela. E selas são fugíveis — o ruído do SGD e o momentum dão exatamente o empurrão necessário.

**Os mínimos que existem tendem a ter qualidade parecida.** Empiricamente, treinar a mesma arquitetura com inicializações diferentes converge para perdas similares. A paisagem não é um pico solitário de qualidade cercado de armadilhas; é um conjunto grande de vales equivalentes.

**Sobre-parametrização suaviza a paisagem** e cria variedades conexas de soluções que interpolam os dados, o que torna a descida mais fácil, não mais difícil.

**E o ponto conceitual mais importante: nós não queremos o mínimo global do erro de treino.** O mínimo global de treino é, com frequência, uma solução que decorou os dados. O que buscamos é generalização, e o ruído do SGD — que impede a convergência exata a um mínimo — é parte do que produz isso, através do viés implícito para soluções de menor norma e mais planas.

---

**🔴 O que é o problema de gradientes que desaparecem e como a otimização lida com ele?**

**Resposta modelo:** Numa rede profunda, o gradiente de uma camada inicial é o produto de muitos termos pela regra da cadeia. Se esses termos são consistentemente menores que 1, o produto decai exponencialmente com a profundidade e as primeiras camadas praticamente não recebem sinal de aprendizado. Se são maiores que 1, o produto explode.

As soluções, e cada uma ataca um ponto diferente da cadeia:

**Funções de ativação com derivada não-saturante** — ReLU tem derivada exatamente 1 na região ativa, então não contribui com um fator de encolhimento. É a razão de ReLU ter substituído sigmoide e tanh, cujas derivadas máximas são 0.25 e 1 e saturam nos extremos.

**Inicialização adequada** — He para ReLU, Xavier/Glorot para tanh. Elas escalam a variância dos pesos para preservar a variância do sinal e do gradiente ao longo das camadas, evitando que o produto decaia ou exploda logo de início.

**Conexões residuais** — a mudança estrutural mais importante. `y = x + F(x)` cria um caminho aditivo pelo qual o gradiente flui sem ser multiplicado pelos pesos da camada, o que quebra a cadeia multiplicativa. É o que tornou possível treinar redes de centenas de camadas.

**Normalização** (batch norm, layer norm) — mantém as ativações numa faixa bem-comportada, o que estabiliza as magnitudes dos gradientes ao longo das camadas.

**Gradient clipping** — para o lado da explosão. Limita a norma do gradiente, o que é padrão em RNNs e em treino de LLMs.

**Arquiteturas com gating** — LSTM e GRU criam um caminho aditivo para o estado da célula, com o mesmo espírito das residuais.

Detalhamento em [07 — Redes neurais](07-redes-neurais.md).

---

**🔴 Como você ajustaria hiperparâmetros de forma eficiente?**

**Resposta modelo:** Começaria pelo que importa: existe uma hierarquia clara de impacto e gastar orçamento uniformemente é desperdício. Em deep learning, learning rate e schedule dominam; depois tamanho do batch e regularização; arquitetura fina costuma render pouco. Em gradient boosting, learning rate com número de árvores é o eixo principal, seguido de profundidade e do mínimo de amostras por folha.

Sobre o método: **grid search é ruim** e a razão é específica — com um grid, se um hiperparâmetro é irrelevante, você desperdiça todas as avaliações repetindo os mesmos valores dos relevantes. **Busca aleatória** explora muito mais valores distintos dos parâmetros que importam com o mesmo orçamento, e é por isso que ela costuma superar grid na prática. **Otimização bayesiana** (TPE, processos gaussianos) usa as avaliações anteriores para decidir onde amostrar em seguida, e vale quando cada treino é caro. **Hyperband / ASHA** aloca orçamento adaptativamente, matando cedo configurações ruins — é o que eu usaria com treinos longos, porque tipicamente dá para descartar 80% das configurações depois de poucas épocas.

Escolhas práticas: amostrar em **escala logarítmica** para learning rate e regularização, porque o que importa é a ordem de grandeza; usar o mesmo split de validação para todas as configurações para que a comparação seja justa; e — o que é fácil esquecer — **evitar overfittar na validação**, limitando o número de avaliações, usando a regra do erro-padrão para preferir o modelo mais simples entre os equivalentes, e reservando um teste realmente intocado.

E antes de tudo isso: eu conferiria se o problema é mesmo de hiperparâmetro. Ganhos de features ou de correção de dados quase sempre superam ganhos de tuning, e tuning é a atividade mais fácil de confundir com progresso.

---

## 3. Armadilhas comuns

**Achar que o gradiente aponta para o mínimo.** Aponta na direção de descida mais íngreme localmente, o que em superfícies alongadas atravessa o vale.

**Usar Adam com learning rate padrão em tudo e nunca ajustar.** Adam é robusto, não imune.

**Confundir Adam com AdamW.** A diferença no tratamento do weight decay é real e afeta generalização.

**Esquecer a correção de viés do Adam.** Sem ela, os primeiros passos são desproporcionais.

**Aumentar o batch sem ajustar o learning rate.** Costuma piorar generalização, e a causa não é o batch em si.

**Não usar warmup com transformers ou batches grandes.** Instabilidade no início do treino é quase garantida.

**Usar MSE em classificação.** Não-convexa com sigmoide, e gradiente que satura justamente quando o modelo está confiante e errado.

**Otimizar a perda e reportar a métrica sem reconhecer a lacuna.** São objetivos diferentes; a diferença precisa ser gerenciada explicitamente.

**Achar que perda menor sempre significa modelo melhor.** Perda de treino menor pode ser overfitting; e perdas diferentes não são comparáveis entre si.

**Grid search por padrão.** Busca aleatória ou bayesiana são estritamente melhores com o mesmo orçamento.

**Ajustar hiperparâmetros no conjunto de teste.**

**Não fazer o teste de overfittar um lote pequeno antes de depurar hiperparâmetros.** Se você não consegue decorar 32 exemplos, o problema é um bug, não o learning rate.

**Interpretar perda de treino maior que a de validação como bug.** Com dropout e augmentation ativos só no treino, isso é esperado.
