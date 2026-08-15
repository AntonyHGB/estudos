# 01 — Fundamentos

> Tipos de aprendizado, bias-variance, overfitting/underfitting, regularização.
> Este é o tópico mais cobrado de todos. Perguntas daqui aparecem disfarçadas dentro de perguntas de todos os outros tópicos.

---

## 1. Resumo conceitual

### 1.1 O que ML está realmente fazendo

Todo problema supervisionado é: existe uma função verdadeira desconhecida `f` que mapeia entradas `X` para saídas `y`, e você observa amostras ruidosas `y = f(X) + ε`. Seu modelo produz uma estimativa `f̂`. O que você quer minimizar não é o erro nos dados que você tem — é o **erro esperado em dados que você nunca viu**, o *risco esperado*. Como você não tem acesso a essa distribuição, você minimiza o *risco empírico* (erro no treino) e torce para que ele se aproxime do risco verdadeiro.

Toda a teoria de generalização vive nessa lacuna. Overfitting, regularização, validação — tudo é tentativa de controlar a diferença entre "erro que eu consigo medir" e "erro que eu realmente quero".

Uma consequência que vale internalizar: **o modelo aprende a distribuição dos dados de treino, não o fenômeno do mundo.** Se seu treino tem viés de amostragem, o modelo aprende o viés com a mesma fidelidade com que aprende o sinal. Isso não é bug, é a definição do que ele faz.

### 1.2 Supervisionado, não-supervisionado, por reforço

**Supervisionado** — você tem pares `(X, y)`. O rótulo `y` fornece um sinal de erro direto e por amostra: para cada exemplo, você sabe exatamente o quanto errou. Subdivide-se em classificação (`y` categórico) e regressão (`y` contínuo). É de longe o mais usado na indústria porque é o que funciona de forma confiável quando existem rótulos.

O gargalo real do supervisionado quase nunca é o algoritmo — é obter rótulos corretos, em volume, e que representem o que você realmente quer prever. Boa parte do trabalho sênior é perceber que o rótulo disponível é um *proxy* do objetivo verdadeiro (você quer prever "usuário gostou", mas seu rótulo é "usuário clicou") e raciocinar sobre a distorção que isso introduz.

**Não-supervisionado** — você só tem `X`. Não existe sinal de erro externo; o algoritmo otimiza um critério interno (compacidade de clusters, variância explicada, verossimilhança sob um modelo de densidade). A consequência prática decisiva: **não existe uma resposta objetivamente certa e, portanto, não existe validação limpa**. Avaliar clustering é intrinsecamente mais frágil do que avaliar classificação. Usos típicos: segmentação, redução de dimensionalidade, detecção de anomalias, compressão.

**Auto-supervisionado** (vale mencionar, é o que sustenta LLMs) — tecnicamente supervisionado, mas o rótulo é gerado automaticamente a partir da própria estrutura do dado: prever a próxima palavra, prever um trecho mascarado, prever se dois recortes vêm da mesma imagem. Isso resolve o gargalo de rotulagem e é a razão de o pré-treinamento em escala ser viável.

**Por reforço** — um agente age num ambiente, recebe recompensas, e aprende uma política que maximiza recompensa acumulada. Três diferenças estruturais em relação ao supervisionado, e são elas que o entrevistador quer ouvir:

1. **O feedback é avaliativo, não instrutivo.** A recompensa diz "isso foi bom" mas não diz "o certo era aquilo". Você não recebe o gradiente da resposta correta.
2. **O feedback é atrasado e o crédito é ambíguo** (*credit assignment problem*): a jogada que perdeu a partida de xadrez pode ter sido o lance 12, não o lance 40.
3. **Os dados dependem da política.** O agente coleta os próprios dados; mudar a política muda a distribuição de dados. Isso quebra a suposição i.i.d. e cria o dilema **exploration vs exploitation** — explorar ações desconhecidas custa recompensa no curto prazo mas é a única forma de descobrir algo melhor.

Onde aparece na prática: robótica, jogos, otimização de sistemas, e — o exemplo que todo entrevistador vai citar em 2026 — RLHF/RLAIF no alinhamento de LLMs.

### 1.3 Bias-variance tradeoff

É a decomposição mais cobrada de todas. Para erro quadrático, o erro esperado num ponto se decompõe em:

```
E[(y - f̂(x))²]  =  Bias[f̂(x)]²  +  Var[f̂(x)]  +  σ²
                    (erro sistemático) (instabilidade)  (ruído irredutível)
```

**Bias** é o erro por suposições erradas do modelo. Formalmente, `E[f̂(x)] - f(x)`: a diferença entre a previsão média do seu modelo (média sobre diferentes datasets de treino) e a verdade. Alto bias significa que **mesmo com dados infinitos** o modelo erraria — ele é rígido demais para representar o fenômeno. Ajustar uma reta a dados quadráticos tem bias alto e nenhuma quantidade de dados resolve.

**Variância** é a sensibilidade do modelo à amostra específica de treino. Formalmente `E[(f̂(x) - E[f̂(x)])²]`. Alta variância significa que se você retreinasse com outra amostra da mesma população, obteria um modelo bem diferente. Isso é ruim porque a sua amostra específica contém ruído, e um modelo de alta variância modela esse ruído.

**Ruído irredutível (σ²)** é o piso. Vem da aleatoriedade intrínseca do fenômeno e de variáveis preditivas que você simplesmente não tem. Nenhum modelo passa desse piso — e reconhecer isso numa entrevista é um sinal forte de maturidade: quando alguém pergunta "como você chegaria a 100% de acurácia?", a resposta certa costuma ser "provavelmente não chego, e se eu chegasse eu suspeitaria de leakage".

**A intuição que faz a ideia colar:** imagine treinar o mesmo tipo de modelo 100 vezes, cada vez com uma amostra diferente da mesma população, e olhar as 100 previsões para um ponto fixo. Bias é o quanto o *centro* dessa nuvem de previsões está deslocado da verdade. Variância é o quanto a nuvem está *espalhada*. Um alvo de tiro: bias é mirar torto de forma consistente; variância é ter a mão trêmula.

O **tradeoff** existe porque aumentar a flexibilidade do modelo tipicamente reduz bias e aumenta variância. Mais profundidade na árvore, mais features, menos regularização — tudo empurra nessa direção.

**Nuance importante para 🔴:** o tradeoff clássico é uma curva em U (erro de teste desce, atinge mínimo, sobe). Isso é bem estabelecido para modelos clássicos. Em redes neurais muito sobre-parametrizadas observa-se o fenômeno de **double descent**: após o pico de erro no ponto de interpolação (onde o modelo tem parâmetros suficientes para ajustar exatamente o treino), continuar aumentando a capacidade faz o erro de teste *voltar a cair*. A explicação corrente é que, entre as infinitas soluções que ajustam o treino perfeitamente, o viés implícito do SGD favorece as de menor norma, que generalizam melhor. Se você citar isso, cite como fenômeno observado — não afirme que "invalida" o bias-variance tradeoff, porque não invalida; ele reformula o que "capacidade" significa.

### 1.4 Overfitting e underfitting

**Overfitting** = variância alta. O modelo decorou padrões da amostra de treino que não existem na população. Assinatura: **erro de treino baixo, erro de validação muito maior, e a lacuna cresce com o treinamento**.

**Underfitting** = bias alto. Assinatura: **erro alto tanto em treino quanto em validação, e próximos entre si**.

O diagnóstico correto vem de olhar os dois erros juntos, nunca um só:

| Erro treino | Erro validação | Diagnóstico | Ação |
|---|---|---|---|
| Alto | Alto (≈ treino) | Underfitting | Mais capacidade, melhores features, menos regularização, treinar mais |
| Baixo | Alto | Overfitting | Mais dados, mais regularização, menos capacidade, early stopping |
| Baixo | Baixo | Bom | Verifique se não é leakage bom demais |
| Alto | Baixo | Suspeito | Bug, ou val mais fácil que treino, ou dropout/augmentation ativo só no treino |

**Curvas de aprendizado** (erro vs. quantidade de dados) são a ferramenta de diagnóstico que impressiona em entrevista, porque respondem a pergunta "vale a pena coletar mais dados?":

- Se as curvas de treino e validação **convergiram e ficaram juntas num erro alto** → bias alto. Mais dados **não** ajudam. Você precisa de um modelo melhor ou features melhores.
- Se ainda existe **uma lacuna grande** e a curva de validação ainda está descendo → variância alta. Mais dados ajudam.

Isso é ouro numa entrevista de system design, porque transforma "vamos coletar mais dados" de palpite em decisão fundamentada.

### 1.5 Regularização

Regularização é qualquer coisa que restringe o espaço de soluções para reduzir variância, aceitando um pouco mais de bias. A forma clássica adiciona uma penalidade à função de custo:

```
J(w) = Perda(dados) + λ · Penalidade(w)
```

`λ` controla o tradeoff: `λ = 0` é sem regularização; `λ → ∞` empurra todos os pesos a zero (bias máximo). `λ` é um hiperparâmetro e **se escolhe por validação, nunca pelo teste**.

**L2 (Ridge), penalidade `λ Σ wᵢ²`.** Encolhe todos os coeficientes proporcionalmente ao seu tamanho, mas **não zera nenhum**. Por quê: o gradiente da penalidade é `2λw`, que **encolhe junto com o peso**. Quando `w` já é pequeno, a força que empurra para zero também é pequena, e ela equilibra com o gradiente da perda antes de chegar a zero. Efeito prático: com features correlacionadas, L2 *distribui* o peso entre elas, o que estabiliza o modelo. Solução analítica: `w = (XᵀX + λI)⁻¹Xᵀy` — o `λI` torna a matriz invertível mesmo com multicolinearidade perfeita, que é a razão histórica do nome "ridge".

**L1 (Lasso), penalidade `λ Σ |wᵢ|`.** **Zera coeficientes**, produzindo soluções esparsas e, portanto, seleção automática de features. Por quê: o gradiente (subgradiente) da penalidade é `λ · sign(w)`, de **magnitude constante** independentemente do tamanho de `w`. Ele continua empurrando com a mesma força quando `w` é minúsculo, então chega em zero exatamente — e zero é um ponto estável porque a função tem um "bico" ali.

A explicação geométrica é a que os entrevistadores adoram: as curvas de nível da perda são elipses; a região de restrição de L2 é um círculo (bola L2), a de L1 é um losango (bola L1). O ponto de contato entre a elipse e a bola é a solução. O losango tem **quinas nos eixos**, e uma elipse tem probabilidade alta de tocar primeiro numa quina — e a quina é exatamente o ponto onde alguma coordenada vale zero. O círculo não tem quinas, então o contato quase nunca cai num eixo.

**Elastic Net** — combina as duas: `λ₁Σ|wᵢ| + λ₂Σwᵢ²`. Existe para resolver uma falha concreta do L1: com um grupo de features altamente correlacionadas, o L1 tende a escolher **arbitrariamente uma** e zerar as outras (instável — refaça o treino com outra amostra e ele escolhe outra). O termo L2 do Elastic Net faz o grupo ser selecionado ou descartado em conjunto, o que é mais estável e frequentemente mais interpretável.

**Outras formas de regularização** (importante saber que a palavra é mais ampla que L1/L2): early stopping, dropout, data augmentation, injeção de ruído, batch norm (efeito colateral regularizador), limitar profundidade de árvore, subsample/bagging, weight sharing em CNNs, e — a mais poderosa e menos citada — **mais dados**.

**Detalhe que separa candidatos:** o termo de bias/intercepto **não deve ser regularizado**. Ele não controla complexidade, só desloca a predição; penalizá-lo enviesa o modelo para prever perto de zero sem motivo. Bibliotecas maduras já tratam isso, mas saber a razão é um sinal de que você entende o que a penalidade faz.

**E outro:** regularização L1/L2 **exige features escalonadas**. A penalidade é aplicada à magnitude do coeficiente, e a magnitude do coeficiente depende da unidade da feature. Uma feature em metros e a mesma feature em quilômetros geram coeficientes com escalas 1000× diferentes e, portanto, penalidades completamente diferentes para o mesmo modelo. Sem padronizar, você está regularizando arbitrariamente com base em escolha de unidade.

### 1.6 Interpretação bayesiana (bom para 🔴)

Regularização L2 é matematicamente equivalente a **MAP com prior gaussiano** sobre os pesos (média zero); L1 equivale a MAP com **prior de Laplace**. Isso não é curiosidade: dá um significado a `λ` — ele codifica quão fortemente você acredita, *antes de ver os dados*, que os coeficientes são pequenos. Um prior de Laplace tem pico agudo em zero, o que é exatamente a crença "a maioria das features é irrelevante" e explica a esparsidade. Ver o detalhamento em [10 — Estatística e probabilidade](10-estatistica-probabilidade.md).

### 1.7 No Free Lunch

O teorema *No Free Lunch* diz que, **na média sobre todos os problemas possíveis**, todos os algoritmos têm o mesmo desempenho. A implicação prática não é "nada funciona" — é que **todo bom desempenho vem de suposições sobre a estrutura do problema que por acaso são verdadeiras**. Redes convolucionais funcionam em imagens porque assumem localidade e invariância a translação, e imagens de fato têm isso. Não existe "melhor algoritmo" fora de contexto — só existe melhor *encaixe entre as suposições do modelo e a estrutura dos dados*.

É a resposta certa para "qual é o melhor algoritmo de ML?", e a razão pela qual a resposta "depende" só é aceitável se você disser **depende de quê**.

---

## 2. Perguntas de entrevista

---

**🟢 Qual a diferença entre aprendizado supervisionado e não-supervisionado?**

**Resposta modelo:** No supervisionado você tem pares entrada-rótulo, então cada exemplo fornece um sinal de erro direto: você compara a previsão com a resposta certa. Classificação e regressão são os dois casos, conforme o rótulo seja categórico ou contínuo. No não-supervisionado você só tem as entradas; o algoritmo otimiza um critério interno como compacidade de clusters ou variância explicada. A consequência prática mais importante é a avaliação: no supervisionado você mede erro contra a verdade em dados retidos, no não-supervisionado não existe verdade objetiva, então a validação é intrinsecamente mais frágil e frequentemente depende de julgamento humano ou de uma tarefa downstream.

**Follow-up comum:** *"Onde entra o auto-supervisionado?"* — Tecnicamente é supervisionado, mas o rótulo é derivado automaticamente da estrutura do próprio dado (prever a próxima palavra, reconstruir um trecho mascarado). Isso remove o gargalo de rotulagem manual e é o que torna viável pré-treinar em escala — é a base dos LLMs.

**Follow-up:** *"Semi-supervisionado?"* — Poucos dados rotulados e muitos não rotulados. A ideia central é usar a estrutura dos dados não rotulados (por exemplo, a suposição de que a fronteira de decisão passa por regiões de baixa densidade) para orientar o modelo. Pseudo-labeling e consistency regularization são as técnicas mais citadas.

---

**🟢 Explique overfitting. Como você detecta e como corrige?**

**Resposta modelo:** Overfitting é quando o modelo aprende padrões específicos da amostra de treino que não generalizam — ele modelou o ruído junto com o sinal. Eu detecto comparando erro de treino e de validação: overfitting é erro de treino baixo com erro de validação significativamente maior, e a lacuna aumentando ao longo do treinamento. Isso é diferente de underfitting, onde ambos os erros são altos e próximos.

Para corrigir, ataco pelas causas: mais dados de treino é a solução mais confiável quando é viável; aumentar a regularização (L1/L2, dropout, early stopping); reduzir a capacidade do modelo (menos profundidade, menos features); data augmentation quando o domínio permite; e ensembles, que reduzem variância por média. A escolha depende do que está barato — se coletar dados custa caro, regularizo; se tenho dados de sobra, aumento eles antes de mexer no modelo.

**Follow-up quase garantido:** *"Como você sabe que a diferença entre 0.90 de treino e 0.87 de validação é overfitting e não flutuação amostral?"* — Não sei olhando um número só. Eu olharia o intervalo de confiança dessa diferença via cross-validation: se o desvio-padrão entre folds é 0.03, uma diferença de 0.03 é ruído. Uma lacuna é preocupante quando é grande em relação à variabilidade entre folds e quando cresce sistematicamente com a capacidade do modelo.

**Follow-up 🔴:** *"E se val e teste discordam?"* — Sinal de que eu overfittei no conjunto de validação por seleção de hiperparâmetros — testei tantas configurações que escolhi a que teve sorte na validação. É o caso de usar nested cross-validation ou reservar um teste realmente intocado. Ver [03 — Validação](03-validacao-e-dados.md).

---

**🟢 O que é o bias-variance tradeoff?**

**Resposta modelo:** É a decomposição do erro esperado em três partes: bias ao quadrado, variância e ruído irredutível. Bias é erro por suposições rígidas demais — o modelo erraria mesmo com dados infinitos, porque não consegue representar o fenômeno. Variância é sensibilidade à amostra específica de treino — se eu retreinasse com outra amostra da mesma população, obteria um modelo bem diferente. Ruído irredutível é o piso que nenhum modelo ultrapassa.

O tradeoff aparece porque aumentar a flexibilidade do modelo geralmente reduz bias e aumenta variância. A intuição do alvo de tiro: bias é mirar consistentemente torto, variância é ter a mão trêmula. Na prática eu uso isso como ferramenta de diagnóstico — se treino e validação são ambos ruins, é bias e eu preciso de mais capacidade ou features melhores; se treino é bom e validação é ruim, é variância e eu preciso de regularização ou mais dados.

**Follow-up:** *"Dê um exemplo de modelo de alto bias e um de alta variância."* — Regressão linear em dados não-lineares é o exemplo canônico de alto bias. Uma árvore de decisão sem poda é o de alta variância: ela consegue ajustar exatamente qualquer conjunto de treino e muda drasticamente com pequenas mudanças nos dados. kNN com k=1 é outro: alta variância; e conforme k cresce, você troca variância por bias.

**Follow-up 🔴:** *"Random forest reduz bias ou variância?"* — Principalmente variância. Cada árvore individual é de alta variância e baixo bias; a média sobre árvores descorrelacionadas reduz a variância sem aumentar muito o bias. A chave é a descorrelação — daí a amostragem aleatória de features em cada split, além do bootstrap. Se as árvores fossem idênticas, a média não reduziria nada. Boosting, ao contrário, reduz principalmente bias, somando aprendizes fracos sequencialmente.

---

**🟡 Qual a diferença entre regularização L1 e L2? Quando você usaria cada uma?**

**Resposta modelo:** L2 adiciona a soma dos quadrados dos pesos ao custo, L1 adiciona a soma dos valores absolutos. A diferença prática decisiva é que **L1 zera coeficientes e L2 só os encolhe**.

O motivo é o gradiente da penalidade. Em L2 o gradiente é proporcional ao peso, então a força que empurra para zero encolhe junto com o peso e ela se equilibra com o gradiente da perda antes de chegar a zero. Em L1 o gradiente tem magnitude constante — ele continua empurrando com a mesma força mesmo quando o peso é minúsculo, então atinge zero exatamente. Geometricamente: a região de restrição do L1 é um losango com quinas nos eixos, e as curvas de nível da perda tendem a tocar primeiro numa quina, que é onde uma coordenada vale zero. A do L2 é uma esfera, sem quinas.

Uso L1 quando quero seleção automática de features, quando suspeito que a maioria das features é irrelevante, ou quando preciso de um modelo enxuto e interpretável. Uso L2 como padrão quando acredito que muitas features contribuem um pouco cada, e especialmente com features correlacionadas, porque L2 distribui peso entre elas em vez de escolher uma arbitrariamente. Elastic Net quando quero esparsidade mas tenho grupos de features correlacionadas — o termo L2 estabiliza a seleção dentro do grupo.

**Follow-up:** *"Por que L1 é instável com features correlacionadas?"* — Se duas features são quase idênticas, várias combinações de coeficientes dão praticamente a mesma perda e a mesma penalidade L1 (porque |a| + |b| é constante ao longo de uma direção). A solução não é única e pequenas perturbações nos dados mudam qual feature é selecionada. L2 quebra esse empate porque a penalidade quadrática é estritamente minimizada quando o peso é dividido igualmente.

**Follow-up:** *"Você regulariza o intercepto?"* — Não. O intercepto não controla complexidade, só desloca a predição. Penalizá-lo enviesa o modelo para prever perto de zero por nenhuma razão principiada.

**Pegadinha:** *"Preciso escalonar as features antes de regularizar?"* — **Sim, e isso não é opcional.** A penalidade age sobre a magnitude do coeficiente, que é inversamente proporcional à escala da feature. Trocar metros por quilômetros muda o coeficiente por 1000× e portanto muda quanto aquela feature é penalizada, sem nada de substantivo ter mudado. Sem padronizar, sua escolha de unidades vira uma escolha de regularização.

---

**🟡 Erro de treino baixo, erro de validação alto. O que você faz?**

**Resposta modelo:** É a assinatura de overfitting, mas antes de tratar como overfitting eu descartaria duas coisas mais graves. Primeiro, **leakage invertido ou distribuições diferentes**: a validação pode não vir da mesma distribuição do treino — split feito errado, período temporal diferente, grupos vazando. Segundo, um **bug no pipeline**: transformações ajustadas em treino aplicadas de forma inconsistente na validação.

Descartadas essas, eu trato como variância: primeiro tento curvas de aprendizado para saber se mais dados resolveriam — se a curva de validação ainda está descendo com mais dados, coletar dados é o melhor investimento. Se não, aumento a regularização progressivamente, reduzo a capacidade do modelo, e uso early stopping. Simplificar features também: com poucos exemplos e muitas features, o overfitting é quase garantido.

**Follow-up:** *"E se, depois de tudo, a lacuna persistir?"* — Aceito e reporto honestamente. Uma lacuna pequena e estável é normal; o que importa é o erro de validação absoluto, não a lacuna. Um modelo com 0.85 de treino e 0.84 de validação é pior que um com 0.95 de treino e 0.90 de validação, mesmo tendo lacuna menor. **A lacuna é diagnóstico, não é métrica de objetivo.**

---

**🟡 Como você diferencia aprendizado por reforço de supervisionado, e quando usaria RL?**

**Resposta modelo:** Três diferenças estruturais. Primeiro, o feedback é **avaliativo e não instrutivo**: a recompensa diz que a ação foi boa ou ruim, mas não diz qual era a ação certa — eu não recebo o gradiente da resposta correta. Segundo, o feedback é **atrasado**, o que cria o problema de atribuição de crédito: numa partida perdida, qual das 40 jogadas foi a culpada? Terceiro, e mais importante, **os dados dependem da política**: o agente coleta os próprios dados, então mudar a política muda a distribuição dos dados. Isso quebra a suposição i.i.d. e cria o dilema exploração vs. explotação (exploration vs. exploitation).

Eu usaria RL quando o problema é **sequencial**, quando as ações **afetam o estado futuro**, e quando não tenho rótulos supervisionados do que é a ação ótima — só um sinal de qualidade do resultado. Se eu tenho as ações ótimas rotuladas, aprendizado supervisionado (imitation learning) é mais simples e mais estável e eu escolheria ele.

Na prática, RL puro é caro e instável, então costuma valer a pena só quando a simulação é barata (jogos, ambientes simulados) ou quando o ganho é grande o bastante para justificar (RLHF em LLMs, onde o objetivo — "resposta útil" — é difícil de especificar como perda supervisionada mas fácil de julgar comparativamente).

**Follow-up 🔴:** *"Por que RLHF em vez de só fine-tuning supervisionado?"* — Porque para muitas propriedades desejáveis a gente sabe *comparar* duas respostas mas não sabe *escrever* a resposta ideal em volume. O RLHF explora isso: treina-se um modelo de recompensa a partir de comparações humanas e depois otimiza a política contra ele. O ponto de fragilidade é o **reward hacking** — o modelo otimiza o proxy (o modelo de recompensa) e não a preferência humana real, e a otimização excessiva contra um proxy imperfeito degrada a qualidade verdadeira. Por isso se usa uma penalidade KL contra o modelo de referência, para impedir que a política se afaste demais.

---

**🟡 Se você adiciona mais dados de treino, o que acontece com bias e variância?**

**Resposta modelo:** Variância **diminui** — mais dados significam que o modelo é menos sensível a peculiaridades de qualquer amostra específica, e as estimativas dos parâmetros ficam mais estáveis. Bias **essencialmente não muda**, porque bias é uma propriedade da classe de modelos, não da quantidade de dados. Uma reta continua sendo uma reta com um bilhão de pontos.

Por isso a pergunta "mais dados vão ajudar?" é respondida por curvas de aprendizado: se treino e validação já convergiram juntos num erro alto, o problema é bias e mais dados são desperdício de orçamento — preciso de um modelo mais expressivo ou de features melhores. Se ainda há lacuna e a curva de validação está descendo, mais dados ajudam.

**Nuance que vale citar:** mais dados *indiretamente* permitem reduzir bias, porque viabilizam usar um modelo de maior capacidade sem overfittar. É exatamente essa a lógica das leis de escala em deep learning — dados e capacidade escalam juntos.

---

**🔴 Explique por que a decomposição bias-variance é problemática para classificação.**

**Resposta modelo:** A decomposição exata em três termos aditivos é derivada para **erro quadrático**. Para perda 0-1 ela não se decompõe de forma aditiva limpa — existem formulações propostas (Domingos, Kohavi-Wolpert), mas elas discordam entre si e envolvem definições diferentes de "bias" para perdas não-quadráticas. Um efeito contraintuitivo concreto: em classificação, a variância pode **reduzir** o erro. Se a previsão média está do lado errado da fronteira de decisão, ruído nas previsões faz parte delas cair do lado certo, o que baixa a taxa de erro.

Na prática eu uso bias-variance em classificação como **linguagem qualitativa de diagnóstico** — "isso parece variância, vou regularizar" — e não como decomposição numérica. Para decompor de fato, eu decomporia a **log-loss** ou o **Brier score**, que são perdas próprias e admitem tratamento mais limpo.

---

**🔴 O que é double descent e o que ele diz sobre o bias-variance tradeoff?**

**Resposta modelo:** A curva clássica em U prevê que o erro de teste sobe monotonicamente depois que a capacidade passa do ponto ótimo. O que se observa empiricamente em modelos modernos é diferente: o erro sobe até um pico no **limiar de interpolação** — o ponto onde o modelo tem parâmetros suficientes para ajustar o treino exatamente — e depois, ao continuar aumentando a capacidade, **volta a cair**, frequentemente abaixo do mínimo da primeira descida.

A explicação corrente é sobre **viés implícito da otimização**: no regime muito sobre-parametrizado existem infinitas soluções que zeram o erro de treino, e o SGD não escolhe uma qualquer — ele converge preferencialmente para soluções de menor norma, que são mais suaves e generalizam melhor. Perto do limiar de interpolação existe exatamente *uma* solução que interpola, e ela é forçada a ser contorcida, daí o pico.

Isso não invalida o bias-variance tradeoff; ele mostra que **contagem de parâmetros é uma medida ruim de capacidade efetiva**. A capacidade que importa é a do conjunto de soluções que o otimizador de fato alcança, não a do espaço de hipóteses nominal. Também se observa double descent em função do número de épocas e da quantidade de dados, não só do tamanho do modelo.

---

**🔴 Qual o "melhor" algoritmo de machine learning?**

**Resposta modelo:** Não existe, e o teorema No Free Lunch formaliza isso: na média sobre todos os problemas possíveis, todos os algoritmos têm desempenho equivalente. O que isso realmente significa é que **todo bom desempenho vem de suposições sobre a estrutura do problema que por acaso são verdadeiras**. CNNs funcionam em imagens porque assumem localidade e invariância a translação, e imagens têm isso. Modelos lineares funcionam quando a relação é aproximadamente linear.

Dito isso, na prática existem defaults muito razoáveis por tipo de dado, e eu daria isso como resposta concreta em vez de me esconder no "depende": para **dados tabulares**, gradient boosting é o padrão que vence na esmagadora maioria dos casos, com regressão logística como baseline obrigatório. Para **imagem, texto e áudio**, redes neurais pré-treinadas com fine-tuning. A razão da divisão é que dados tabulares têm features heterogêneas e já semanticamente significativas — não há estrutura espacial ou sequencial para uma rede explorar — enquanto imagem e texto têm exatamente a estrutura composicional que arquiteturas profundas foram feitas para capturar.

---

**🔴 Você tem 500 exemplos rotulados e 500 mil não rotulados. Como aborda?**

**Resposta modelo:** Com 500 rótulos, meu inimigo principal é variância, então todas as decisões vão nessa direção.

Primeiro, **validação antes de tudo**: com 500 exemplos, um único split de validação é ruído puro. Eu usaria k-fold repetido ou até leave-one-out, e reportaria intervalos, não pontos. Sem isso, toda decisão seguinte é chute.

Segundo, aproveitar os não rotulados. As opções por ordem de custo-benefício: (a) **pré-treinamento auto-supervisionado** ou uso de um modelo de fundação já pré-treinado no domínio, extraindo embeddings e treinando só um classificador leve por cima — quase sempre o maior ganho por esforço; (b) **pseudo-labeling** com limiar de confiança alto e iterativo, sabendo que ele amplifica os próprios erros e precisa de controle; (c) **active learning** — usar o modelo para escolher quais 200 exemplos adicionais rotular, priorizando os de maior incerteza ou maior representatividade, o que costuma valer muito mais que 200 rótulos aleatórios.

Terceiro, **modelo simples e fortemente regularizado**: regressão logística ou modelo linear sobre embeddings, não uma rede treinada do zero. Com 500 exemplos, capacidade é veneno.

**Follow-up:** *"Riscos do pseudo-labeling?"* — Confirmation bias: o modelo rotula com seus próprios vieses, treina neles, fica mais confiante nos mesmos erros. Mitigo com limiar alto, poucas iterações, monitorando num conjunto rotulado real que nunca recebe pseudo-rótulos, e revertendo se a métrica cair.

---

## 3. Armadilhas comuns

**Confundir "erro de treino baixo" com "modelo bom".** O erro de treino sozinho não informa nada sobre generalização. Um modelo que decora a tabela tem erro de treino zero.

**Achar que alto bias e alta variância são mutuamente exclusivos.** Um modelo pode ter os dois: uma árvore rasa mas instável, ou uma rede mal-arquitetada com poucos dados. Não é uma escala unidimensional — o tradeoff descreve como *tipicamente* eles se movem quando você mexe na capacidade, não uma lei.

**Dizer "L1 é melhor porque faz seleção de features".** Nem sempre você quer descartar features. Com features correlacionadas, L1 é instável e a escolha entre elas é arbitrária. Com sinal distribuído entre muitas features fracas, L1 destrói informação. A resposta certa depende da estrutura do sinal.

**Regularizar sem escalonar.** Torna a força efetiva da regularização dependente das unidades das features. Erro invisível e muito comum.

**Tratar `λ` como constante universal.** `λ` depende dos dados, da escala das features e do tamanho do dataset. Sempre se ajusta por validação.

**Achar que mais dados sempre ajudam.** Se o modelo tem bias alto, mais dados não movem a agulha. Curvas de aprendizado respondem isso — e a resposta muda uma decisão cara de negócio.

**Confundir overfitting com "modelo complexo demais".** Overfitting é uma relação entre capacidade do modelo, quantidade de dados e nível de ruído — não uma propriedade do modelo isolado. O mesmo modelo pode overfittar com 1000 amostras e generalizar bem com 1 milhão.

**Dizer que redes neurais "não overfittam" porque funcionam sobre-parametrizadas.** Elas overfittam sim, e facilmente — o que funciona é a combinação de escala de dados, regularização implícita do SGD e regularização explícita. Tirar tudo isso e treinar uma rede grande em dados pequenos gera overfitting espetacular.

**Usar "não-supervisionado" como sinônimo de "sem avaliação".** Você ainda pode e deve avaliar: métricas internas, estabilidade sob reamostragem, ou — melhor de tudo — desempenho numa tarefa downstream supervisionada.

**Responder "depende" sem dizer de quê.** É a forma mais rápida de parecer que você está evitando a pergunta. "Depende do custo relativo dos erros — se falso negativo custa 50× mais, eu faria X" é a versão que passa.
