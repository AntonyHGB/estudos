# 10 — Estatística e Probabilidade para Entrevista de ML

> Teorema de Bayes, distribuições, teste de hipótese, p-valor, intervalos de confiança, maximum likelihood.
> Cobrado pesado em vagas de data scientist e em empresas de produto (por causa de A/B testing). O padrão é claro: quem sabe explicar p-valor corretamente é minoria, e isso é usado como filtro.

---

## 1. Resumo conceitual

### 1.1 Probabilidade condicional e teorema de Bayes

```
P(A|B) = P(B|A) · P(A) / P(B)
```

Em linguagem de inferência:

```
posterior = verossimilhança × prior / evidência
```

A intuição que importa: **Bayes inverte a direção do condicionamento**. Você sabe `P(teste positivo | doente)` — que é uma propriedade do teste, medida em laboratório — e quer `P(doente | teste positivo)`, que é o que interessa ao paciente. As duas são muito diferentes, e confundi-las é a **falácia da taxa-base**, o erro estatístico mais consequente que existe na prática.

**O exemplo canônico, que você deve saber fazer de cabeça.** Doença com prevalência de 1%. Teste com sensibilidade 99% (`P(+|doente) = 0.99`) e especificidade 99% (`P(-|saudável) = 0.99`). Teste positivo — qual a probabilidade de estar doente?

Raciocínio por frequências naturais, que é mais rápido e menos sujeito a erro que a fórmula: em 10.000 pessoas, 100 têm a doença e 9.900 não. Dos 100 doentes, 99 testam positivo. Dos 9.900 saudáveis, 1% dá falso positivo = 99 pessoas. Total de positivos: 198. Dos quais realmente doentes: 99. **Resposta: 50%.**

A lição: mesmo um teste de 99% de acurácia produz metade de falsos positivos quando a condição é rara, porque o **enorme grupo de saudáveis gera falsos positivos em volume comparável ao dos verdadeiros positivos**. Isso é exatamente a mesma matemática de por que precision desaba com classes desbalanceadas — ver [02](02-metricas-avaliacao.md). Fazer essa conexão numa entrevista é forte.

**Onde Bayes aparece em ML:** Naive Bayes, inferência bayesiana e priors, otimização bayesiana de hiperparâmetros, e a interpretação de regularização como MAP.

### 1.2 Distribuições que caem

**Bernoulli** — um ensaio binário. Média `p`, variância `p(1-p)` (máxima em `p=0.5`). É a distribuição que a regressão logística modela.

**Binomial** — soma de n Bernoullis independentes. Média `np`, variância `np(1-p)`. Aparece em conversões em A/B tests.

**Poisson** — contagens em intervalo fixo, com eventos independentes e taxa constante. Média = variância = `λ`. Essa igualdade é a chave prática: se seus dados de contagem têm **variância muito maior que a média (superdispersão)**, Poisson é inadequado e a alternativa é binomial negativa. Vale saber porque previsão de demanda e de eventos é um caso de uso comum.

**Normal (gaussiana)** — a mais importante, por causa do TCL. Simétrica, definida por média e desvio-padrão. Regra 68-95-99.7 (1, 2 e 3 desvios). Aparece em resíduos, em erros de medição, e em distribuições amostrais de médias.

**Exponencial** — tempo entre eventos de um processo de Poisson. **Sem memória**: a probabilidade de esperar mais 10 minutos independe de já ter esperado 30.

**Log-normal** — o logaritmo é normal. **Extremamente comum em dados reais de negócio**: renda, tempo de sessão, valor de transação, tempo até evento. Assimétrica à direita, com cauda longa. É a razão de a transformação log ser tão útil e de a média ser uma péssima estatística de resumo nesses casos (a mediana é muito mais informativa).

**Uniforme, Beta, Gamma** — Beta é a distribuição natural para modelar uma probabilidade (suporte em [0,1]) e é o prior conjugado da Bernoulli/Binomial, o que a torna a base de bandits Thompson sampling e de testes A/B bayesianos.

**Power law / cauda pesada** — popularidade de itens, tamanho de cidades, tráfego. Importante porque **média e variância podem ser instáveis ou indefinidas**, e a intuição gaussiana falha completamente. É o que gera a cauda longa em recomendação.

### 1.3 Teorema Central do Limite

**Enunciado:** a distribuição da **média amostral** de variáveis i.i.d. com variância finita se aproxima de uma normal conforme `n` cresce, **independentemente da distribuição original**.

Três precisões que separam quem entende de quem repete:

1. **É sobre a distribuição da média amostral (ou soma), não sobre os dados.** Dados log-normais continuam log-normais com n grande; o que fica normal é a distribuição de médias de amostras repetidas.
2. **Exige variância finita.** Distribuições de cauda muito pesada (Cauchy) não obedecem.
3. **A velocidade de convergência depende da assimetria.** A regra de bolso "n ≥ 30" é grosseira: com distribuições muito assimétricas ou com eventos raros, pode-se precisar de milhares. Em A/B tests de conversão com taxas muito baixas, isso importa de verdade.

O TCL é o que justifica usar testes z e t, e o que justifica a fórmula do erro-padrão `σ/√n`.

**A implicação prática mais útil:** o erro-padrão cai com `√n`. Para reduzir a incerteza pela metade, você precisa de **4 vezes** mais dados. É por isso que testes A/B para detectar efeitos pequenos exigem amostras enormes, e é a resposta certa para "por que precisamos de tanto tráfego?".

### 1.4 Teste de hipótese e p-valor

**Estrutura:** hipótese nula `H₀` (tipicamente "não há efeito"), hipótese alternativa `H₁`. Calcula-se uma estatística de teste e o p-valor; se `p < α`, rejeita-se `H₀`.

**A definição correta de p-valor, que precisa ser dita com precisão:**

> **P-valor é a probabilidade de observar um resultado tão extremo quanto o observado, ou mais extremo, SE a hipótese nula fosse verdadeira.**

**O que ele NÃO é** (o entrevistador está esperando por isto):

- **Não é** a probabilidade de a hipótese nula ser verdadeira. Isso seria `P(H₀|dados)`, e o p-valor é `P(dados ou mais extremo | H₀)` — a direção do condicionamento é invertida. Voltamos a Bayes.
- **Não é** a probabilidade de o resultado ter ocorrido por acaso.
- **Não é** uma medida de tamanho do efeito. Com n gigantesco, efeitos irrelevantes dão p-valores minúsculos.
- **p > 0.05 não prova que não há efeito.** Ausência de evidência não é evidência de ausência — pode ser só falta de poder estatístico.

**Erros:**

- **Tipo I (α)** — rejeitar `H₀` verdadeira. Falso positivo. Convencionalmente 5%, um valor arbitrário e historicamente contingente.
- **Tipo II (β)** — não rejeitar `H₀` falsa. Falso negativo.
- **Poder = 1 - β** — probabilidade de detectar um efeito real. Convencionalmente busca-se 80%.

O poder depende de quatro coisas ligadas: **tamanho do efeito, tamanho da amostra, α e variância**. Fixando três, o quarto é determinado — é assim que se faz cálculo de amostra.

**Significância estatística ≠ significância prática.** Com 10 milhões de usuários, um aumento de 0.01% em conversão pode ter p < 0.001 e não pagar o custo de implementação. **Sempre reporte o tamanho do efeito com intervalo de confiança**, não só o p-valor. Essa é a resposta que caracteriza maturidade.

### 1.5 Intervalos de confiança

**A interpretação correta, que é sutil e cai:**

> Um IC de 95% significa que, **se repetíssemos o experimento muitas vezes e construíssemos o intervalo da mesma forma, 95% desses intervalos conteriam o parâmetro verdadeiro.**

**Não** significa "há 95% de probabilidade de o parâmetro estar neste intervalo". No paradigma frequentista, o parâmetro é uma constante fixa (desconhecida) e o intervalo é o que é aleatório — não faz sentido atribuir probabilidade a uma constante. A afirmação "95% de probabilidade de conter o valor" é válida para um **intervalo de credibilidade bayesiano**, que é o análogo bayesiano e tem exatamente essa interpretação. Saber distinguir os dois é um sinal claro de formação estatística.

Na prática, o IC é mais informativo que o p-valor porque comunica **magnitude e precisão** simultaneamente. Um IC de [-0.1%, +5.3%] e outro de [+2.5%, +2.7%] podem ter o mesmo ponto estimado, mas contam histórias completamente diferentes sobre o que você sabe.

**Relação com teste de hipótese:** se o IC de 95% para a diferença não contém zero, o teste bilateral rejeita `H₀` a α = 0.05. São duas expressões da mesma informação, mas o IC comunica melhor.

### 1.6 Testes comuns

| Situação | Teste |
|---|---|
| Comparar duas médias, variância desconhecida | **t-test** (Welch, que não assume variâncias iguais, é o default seguro) |
| Comparar duas proporções | **z-test** para proporções, ou qui-quadrado |
| Comparar 3+ médias | **ANOVA**, seguida de post-hoc com correção |
| Associação entre categóricas | **Qui-quadrado** |
| Sem suposição de normalidade | **Mann-Whitney U** (não-paramétrico) |
| Dados pareados | **t-test pareado**, Wilcoxon |
| Distribuições inteiras | **Kolmogorov-Smirnov** — que é também o teste padrão para detectar drift, ver [11](11-mlops-producao.md) |

**Correção para múltiplas comparações** — importante e cobrada: testando 20 hipóteses a α = 0.05, a chance de ao menos um falso positivo é `1 - 0.95²⁰ ≈ 64%`. Correções: **Bonferroni** (dividir α pelo número de testes — simples, conservador, reduz poder), **Benjamini-Hochberg** (controla a taxa de falsas descobertas em vez do erro familiar; menos conservador e geralmente preferível quando há muitas hipóteses). É diretamente relevante para A/B tests com muitas métricas e para seleção de features.

### 1.7 Maximum Likelihood (MLE) e MAP

**Verossimilhança** é `P(dados | parâmetros)` **vista como função dos parâmetros**, com os dados fixos. **MLE** escolhe os parâmetros que tornam os dados observados mais prováveis.

Trabalha-se com a **log-verossimilhança** por duas razões: transforma produtos em somas (mais fácil de derivar) e evita underflow numérico com muitos fatores pequenos.

**Conexões que amarram todo o curso** — e citá-las é o que faz uma resposta parecer coesa em vez de decorada:

- **Minimizar MSE = MLE sob ruído gaussiano** com variância constante. É por isso que a regressão linear "assume normalidade dos resíduos": não é arbitrário, é o que faz o mínimo quadrado ser o estimador de máxima verossimilhança.
- **Minimizar cross-entropy = MLE sob modelo de Bernoulli/multinomial.** É por isso que log-loss é a perda principiada para classificação.
- **Minimizar MAE = MLE sob ruído de Laplace.**

**MAP (Maximum a Posteriori)** adiciona um prior: maximiza `P(θ|dados) ∝ P(dados|θ)·P(θ)`. Ao tomar log, o prior vira um termo aditivo — que é exatamente uma penalidade de regularização:

- **Prior gaussiano sobre os pesos → penalidade L2 (Ridge).**
- **Prior de Laplace sobre os pesos → penalidade L1 (Lasso).**

Isso dá significado a `λ`: ele codifica a força da sua crença a priori de que os coeficientes são pequenos. E explica a esparsidade do L1 de forma elegante: o prior de Laplace tem um pico agudo em zero, o que corresponde à crença "a maioria das features é irrelevante".

**Propriedades do MLE:** consistente (converge ao valor verdadeiro com n → ∞), assintoticamente eficiente e assintoticamente normal — mas **pode ser enviesado em amostras finitas**. O exemplo clássico é o MLE da variância, que divide por `n` e subestima; a correção de Bessel divide por `n-1`.

### 1.8 Frequentista vs bayesiano

| | Frequentista | Bayesiano |
|---|---|---|
| Parâmetro | Constante fixa desconhecida | Variável aleatória com distribuição |
| Probabilidade | Frequência de longo prazo | Grau de crença |
| Saída | Estimativa pontual, IC, p-valor | Distribuição posterior |
| Prior | Não usa | Usa explicitamente |
| Interpretação de intervalo | "95% dos intervalos conteriam" | "95% de probabilidade de conter" |

**Vantagens práticas do bayesiano em A/B testing:** permite responder diretamente "qual a probabilidade de B ser melhor que A?", que é a pergunta que o negócio realmente faz; incorpora conhecimento prévio; e lida melhor com espiar resultados continuamente, porque não depende de um plano amostral fixo da mesma forma que o teste frequentista clássico (embora não seja imune a todos os problemas de decisão sequencial). **Custo:** escolher o prior é uma decisão subjetiva que precisa ser defendida, e a computação é mais pesada.

### 1.9 Correlação e causalidade

**Correlação de Pearson** mede associação **linear**; é sensível a outliers e vale zero para relações não-lineares fortes (uma parábola perfeita tem correlação zero). **Spearman** mede associação **monótona** via ranks, sendo mais robusta.

**Correlação não implica causalidade**, e as razões concretas são o que vale citar: **confundidor** (uma terceira variável causa as duas — sorvete e afogamento, ambos causados pelo calor), **causalidade reversa**, **viés de seleção** (a amostra foi filtrada por algo relacionado às duas variáveis), e **coincidência** com múltiplas comparações.

**O paradoxo de Simpson** é o exemplo que vale ter na ponta da língua: uma tendência presente em cada subgrupo pode **inverter** quando os grupos são agregados. Consequência prática direta: sempre segmente a análise antes de concluir, e desconfie de conclusões baseadas apenas em agregados.

**Para causalidade, você precisa de:** experimento randomizado (o padrão-ouro, porque a randomização quebra a associação entre tratamento e confundidores, inclusive os não observados) ou de métodos quase-experimentais (diff-in-diff, variáveis instrumentais, regressão descontínua, propensity score matching), todos com suposições explícitas que precisam ser defendidas.

---

## 2. Perguntas de entrevista

---

**🟢 O que é o teorema de Bayes? Dê um exemplo.**

**Resposta modelo:** Ele relaciona `P(A|B)` com `P(B|A)`, permitindo inverter a direção do condicionamento: `P(A|B) = P(B|A)P(A)/P(B)`. Em inferência, é posterior proporcional a verossimilhança vezes prior.

O exemplo que ilustra melhor é o teste médico. Doença com prevalência de 1%, teste com 99% de sensibilidade e 99% de especificidade. Em 10 mil pessoas: 100 doentes, dos quais 99 testam positivo; 9.900 saudáveis, dos quais 1% dá falso positivo, ou seja, 99 pessoas. Total de 198 positivos, metade dos quais realmente doentes. Então, dado um teste positivo, a probabilidade de estar doente é **50%**, não 99%.

A lição é que a taxa-base domina: quando a condição é rara, o grupo enorme de saudáveis gera falsos positivos em volume comparável ao de verdadeiros positivos. É exatamente a mesma matemática de por que a precision desaba em classificação com classes desbalanceadas.

---

**🟢 O que é o Teorema Central do Limite?**

**Resposta modelo:** A distribuição da **média amostral** de variáveis independentes e identicamente distribuídas com variância finita se aproxima de uma normal conforme o tamanho da amostra cresce, independentemente da distribuição original.

Três precisões importantes. É sobre a distribuição **da média amostral**, não sobre os dados — dados log-normais continuam log-normais; o que fica normal é a distribuição de médias de amostras repetidas. Exige variância finita, então distribuições de cauda muito pesada não obedecem. E a regra "n ≥ 30" é grosseira: com distribuições muito assimétricas ou eventos raros, pode ser preciso muito mais.

A consequência mais útil na prática: o erro-padrão é `σ/√n`, então para reduzir a incerteza pela metade você precisa de **quatro vezes** mais dados. É por isso que testes A/B para detectar efeitos pequenos precisam de tanto tráfego.

---

**🟡 O que é um p-valor? Explique como se estivesse falando com alguém não-técnico.**

**Resposta modelo:** É a probabilidade de observar um resultado tão extremo quanto o que eu observei, ou mais extremo, **assumindo que não existe efeito real**. Em linguagem simples: se o botão novo fosse exatamente igual ao antigo, com que frequência o acaso produziria uma diferença tão grande quanto a que eu vi? Se a resposta é "raramente", isso é evidência contra a hipótese de que são iguais.

O que ele **não** é, e essa é a parte que importa mais: não é a probabilidade de a hipótese nula ser verdadeira — isso seria condicionar na direção contrária, o que exigiria um prior. Não é a probabilidade de o resultado ter sido por acaso. E não mede tamanho de efeito: com amostra grande o suficiente, uma diferença irrelevante produz p-valor minúsculo.

Por isso eu nunca reporto p-valor sozinho. Reporto o **tamanho do efeito com intervalo de confiança**, porque é isso que responde "vale a pena implementar?".

**Follow-up quase garantido:** *"p = 0.06. O que você conclui?"* — Que não rejeitei a nula ao nível convencional de 5%, que é um limiar arbitrário e historicamente contingente. Não concluo que não há efeito. Eu olharia o intervalo de confiança: se ele é [-0.5%, +6%], eu simplesmente não tenho poder para distinguir nada e a resposta é coletar mais dados. Se é [-0.1%, +0.3%], eu tenho uma estimativa precisa de que o efeito é pequeno, o que é uma conclusão bem diferente e muito mais útil. O p-valor sozinho não distingue esses dois casos.

---

**🟡 Explique intervalo de confiança. Um IC de 95% significa 95% de probabilidade de conter o valor verdadeiro?**

**Resposta modelo:** Não, e essa é a distinção mais confundida da estatística frequentista. O correto é: se eu repetisse o experimento muitas vezes e construísse o intervalo da mesma forma a cada vez, **95% desses intervalos conteriam o parâmetro verdadeiro**.

A diferença importa porque, no paradigma frequentista, o parâmetro é uma constante fixa desconhecida, e o que é aleatório é o intervalo. Não faz sentido atribuir probabilidade a uma constante: ela está dentro ou fora do meu intervalo específico, eu só não sei qual.

A afirmação "95% de probabilidade de conter" é válida — e é exatamente a interpretação correta — para um **intervalo de credibilidade bayesiano**, porque lá o parâmetro é tratado como variável aleatória com distribuição.

Na prática, eu prefiro reportar intervalos a p-valores, porque o intervalo comunica magnitude e precisão ao mesmo tempo. Dois resultados com o mesmo ponto estimado mas intervalos [-0.1%, +5.3%] e [+2.5%, +2.7%] contam histórias completamente diferentes, e o p-valor pode não distinguir.

---

**🟡 O que é maximum likelihood estimation e como se conecta com as funções de perda que usamos?**

**Resposta modelo:** MLE escolhe os parâmetros que tornam os dados observados mais prováveis sob o modelo. Trabalha-se com a log-verossimilhança porque ela transforma produtos em somas e evita underflow.

A conexão com ML é direta e amarra várias coisas. **Minimizar erro quadrático é equivalente a MLE assumindo ruído gaussiano com variância constante** — é por isso que a regressão linear "assume normalidade dos resíduos": não é uma exigência arbitrária, é o que faz mínimos quadrados ser o estimador de máxima verossimilhança. **Minimizar cross-entropy é MLE sob modelo de Bernoulli**, o que justifica log-loss como a perda principiada para classificação. E **minimizar erro absoluto corresponde a ruído de Laplace**.

Se eu adiciono um prior sobre os parâmetros, viro **MAP**, e ao tomar log o prior vira um termo aditivo — que é exatamente regularização. **Prior gaussiano dá L2, prior de Laplace dá L1.** Isso dá significado a λ: ele codifica quão fortemente eu acredito, antes de ver os dados, que os coeficientes são pequenos. E explica elegantemente por que L1 gera esparsidade: o prior de Laplace tem pico agudo em zero, que é a crença "a maioria das features é irrelevante".

---

**🟡 Como você desenharia um teste A/B?**

**Resposta modelo:** Em ordem, e a maioria das decisões acontece **antes** de rodar.

**Definir a métrica primária antes de começar** — uma só, escolhida por ser causalmente ligada ao objetivo de negócio, e definida operacionalmente sem ambiguidade. Definir também as métricas secundárias e as **guardrails** (métricas que não podem piorar: latência, receita, cancelamentos), com a regra de decisão já escrita.

**Definir o efeito mínimo detectável** — a menor diferença que justificaria implementar a mudança. Isso é uma decisão de negócio, não estatística, e é a entrada mais importante do cálculo.

**Calcular o tamanho da amostra e a duração** a partir do MDE, do poder desejado (tipicamente 80%), do α e da variância da métrica. Duração de pelo menos uma ou duas semanas inteiras, para cobrir ciclos semanais — comportamento de segunda é diferente de sábado, e um teste de três dias mede um pedaço enviesado da semana.

**Randomizar na unidade correta.** Se o efeito é sobre a experiência do usuário, randomize por usuário e não por sessão, senão o mesmo usuário vê as duas versões e o efeito é contaminado. Se há interação entre usuários — marketplaces, redes sociais, efeitos de rede — a randomização por usuário viola a suposição de não-interferência, e pode ser necessário randomizar por cluster ou por região.

**Rodar sem espiar.** Parar assim que o p-valor cruza 0.05 infla enormemente o erro tipo I, porque cada olhada é uma nova chance de rejeitar por acaso. Se eu preciso monitorar, uso métodos de teste sequencial desenhados para isso ou uma abordagem bayesiana.

**Verificar a validade antes de olhar o resultado** — checar se a divisão do tráfego bateu com o esperado (*sample ratio mismatch*, que é um sinal forte de bug de instrumentação e invalida o teste), e conferir se as características pré-tratamento estão balanceadas.

**Analisar** — reportar o efeito com intervalo de confiança, não só p-valor; corrigir para múltiplas comparações se estou olhando muitas métricas; e segmentar para entender heterogeneidade, mas tratando análises de subgrupo como **exploratórias**, porque olhar dez segmentos até achar um significativo é o caminho mais fácil para um falso positivo.

---

**🔴 Você rodou 20 testes A/B e um deu significativo. O que isso significa?**

**Resposta modelo:** Provavelmente nada. Com α de 5% e 20 testes independentes sob a hipótese nula, a probabilidade de ao menos um dar significativo por acaso é `1 - 0.95²⁰`, cerca de **64%**. Ou seja, obter exatamente um significativo em 20 é aproximadamente o que eu esperaria se **nenhuma** das mudanças tivesse efeito.

O que eu faria: aplicar correção para múltiplas comparações. **Bonferroni**, dividindo α pelo número de testes, é simples e conservador, e a esse nível o resultado quase certamente não sobreviveria. **Benjamini-Hochberg** controla a taxa de falsas descobertas em vez do erro familiar, é menos conservador, e é geralmente preferível quando há muitas hipóteses e algumas descobertas falsas são toleráveis.

Independentemente da correção, a ação certa é **replicar** o resultado num teste novo e pré-registrado. Se o efeito é real, ele reaparece; se era ruído, não reaparece. Replicação é a resposta mais convincente e não depende de argumento estatístico sutil.

Eu também levantaria o problema mais amplo: se a organização roda muitos testes e reporta só os que deram certo, o portfólio inteiro de "aprendizados" está contaminado por viés de publicação interno. Isso pede pré-registro das hipóteses e reporte de todos os resultados, inclusive nulos.

---

**🔴 Explique a diferença entre estatística frequentista e bayesiana no contexto de A/B testing.**

**Resposta modelo:** A diferença de fundo é o que se trata como aleatório. No frequentista, o parâmetro — a taxa de conversão verdadeira — é uma constante fixa desconhecida, e o que é aleatório são os dados e portanto os intervalos. No bayesiano, o parâmetro tem uma distribuição que representa meu grau de crença, atualizada pelos dados.

Na prática de A/B testing isso muda o que você consegue afirmar. O frequentista te dá "se não houvesse efeito, eu veria algo assim em 3% das vezes", que é uma afirmação sobre um mundo hipotético. O bayesiano te dá diretamente **"a probabilidade de B ser melhor que A é 94%"** e **"a probabilidade de a perda esperada exceder X é Y"** — que é exatamente a pergunta que a pessoa de produto está fazendo, sem tradução.

Outras vantagens práticas do bayesiano: permite incorporar conhecimento prévio de testes anteriores, e lida melhor com monitoramento contínuo, porque o posterior é válido a qualquer momento e não depende de um plano amostral fixo da mesma forma que o teste clássico. Não é imune a todos os problemas de decisão sequencial, mas é menos frágil.

Os custos: a escolha do prior é subjetiva e precisa ser defendida — com prior forte e dados escassos, ele domina o resultado; e a computação é mais pesada, embora para conversões binárias com prior Beta as fórmulas sejam analíticas e triviais.

Na prática eu escolheria pelo contexto: frequentista onde há convenção estabelecida, requisitos regulatórios ou necessidade de comparabilidade histórica; bayesiano onde a decisão é de produto, o time precisa de interpretação direta, e há volume para monitorar continuamente.

---

**🔴 O que é o paradoxo de Simpson e por que ele importa em ML?**

**Resposta modelo:** É quando uma tendência presente em cada subgrupo se **inverte** ao agregar os grupos. O exemplo clássico: um tratamento tem taxa de sucesso maior que outro em pacientes leves e também em pacientes graves, mas menor no agregado — porque a distribuição de gravidade entre os grupos é desigual, e a gravidade é um confundidor da relação entre tratamento e sucesso.

Importa em ML de várias formas concretas. **Em avaliação de modelos**, um modelo pode ter métrica agregada melhor e ser pior em todos os segmentos relevantes, se a composição de segmentos diferir entre os conjuntos comparados. **Em análise de A/B tests**, agregar períodos ou populações com composições diferentes pode inverter a conclusão — é uma das razões de não comparar semanas diferentes sem controlar composição. **Em fairness**, uma métrica agregada aceitável pode esconder disparidade sistemática por grupo. **E na interpretação de features**, o efeito marginal de uma variável pode ter sinal oposto ao efeito condicional a um confundidor.

A lição prática é direta: **sempre segmente antes de concluir**, e desconfie de decisões tomadas sobre agregados quando a composição dos grupos difere. E, no fundo, o paradoxo é um lembrete de que dados observacionais não determinam a conclusão causal por si sós — a conclusão certa depende de saber qual variável é confundidor e qual é mediador, e isso vem do conhecimento do domínio, não dos dados.

---

**🔴 Qual a diferença entre correlação e causalidade e como você estabeleceria causalidade?**

**Resposta modelo:** Correlação é associação estatística; causalidade é que intervir numa variável muda a outra. Uma correlação pode surgir de quatro formas sem que haja causalidade da direção suposta: um **confundidor** causando as duas, **causalidade reversa**, **viés de seleção** na amostra, ou **coincidência** amplificada por múltiplas comparações.

O padrão-ouro para estabelecer causalidade é o **experimento randomizado**, e a razão é precisa: a randomização quebra a associação entre o tratamento e todos os confundidores, **inclusive os que eu não observo nem imagino**. É isso que nenhum método observacional consegue garantir.

Quando não dá para randomizar — por custo, ética ou impossibilidade prática — existem métodos quase-experimentais, todos com suposições que precisam ser defendidas explicitamente: **diferenças-em-diferenças**, que compara a mudança ao longo do tempo entre grupo tratado e controle e supõe tendências paralelas na ausência de tratamento; **variáveis instrumentais**, que usa uma variável que afeta o tratamento mas não o desfecho por outro caminho; **regressão descontínua**, que explora um limiar arbitrário de elegibilidade; e **propensity score matching**, que só controla confundidores **observados** — e é por isso que ele é o mais fraco da lista.

A conexão com ML que eu faria: modelos preditivos aprendem associação, e por isso **importância de features e SHAP não são efeitos causais**. Se alguém pergunta "então se eu aumentar essa variável, o resultado muda?", o modelo não responde isso. Confundir explicação de modelo com inferência causal leva a decisões de negócio caras e erradas, e é um dos erros mais comuns na interface entre ciência de dados e produto.

---

## 3. Armadilhas comuns

**Definir p-valor como "a probabilidade de a hipótese nula ser verdadeira".** É o erro mais comum e o mais eliminatório do tópico.

**Interpretar IC como "95% de probabilidade de conter o valor".** Válido para credibilidade bayesiana, não para IC frequentista.

**Concluir "não há efeito" a partir de p > 0.05.** Pode ser falta de poder.

**Reportar p-valor sem tamanho de efeito.** Significância estatística não é significância prática.

**Ignorar múltiplas comparações.** 20 testes a 5% dão 64% de chance de ao menos um falso positivo.

**Espiar o teste e parar quando dá significativo.** Infla drasticamente o erro tipo I.

**Confundir a taxa-base.** `P(doente|positivo)` é muito diferente de `P(positivo|doente)`.

**Achar que o TCL diz que os dados ficam normais.** Ele fala da distribuição da média amostral.

**Aplicar "n ≥ 30" mecanicamente.** Com assimetria forte ou eventos raros, é insuficiente.

**Usar Pearson para relações não-lineares.** Uma parábola perfeita tem correlação zero. Use Spearman ou informação mútua.

**Randomizar na unidade errada em A/B test.** Por sessão em vez de por usuário contamina o efeito.

**Ignorar sample ratio mismatch.** É sinal de bug de instrumentação e invalida o teste.

**Tratar análises de subgrupo como confirmatórias.** Olhar dez segmentos até achar um significativo é fabricar resultado.

**Interpretar importância de feature como efeito causal.** Modelos aprendem associação.

**Assumir Poisson para contagens sem checar superdispersão.** Se a variância é muito maior que a média, use binomial negativa.
