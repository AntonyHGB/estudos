# 02 — Métricas de Avaliação

> Matriz de confusão, precision/recall/F1, ROC-AUC vs PR-AUC, quando cada métrica engana, métricas de regressão, calibração.
> Segundo tópico mais cobrado. É onde candidatos aparentemente bons são descartados, porque saber calcular F1 é trivial e saber **escolher** métrica é o que se está avaliando.

---

## 1. Resumo conceitual

### 1.1 O erro conceitual que define este tópico

Métrica não é detalhe de implementação. **A métrica é a definição operacional do que "bom" significa no seu problema.** Escolher a métrica errada faz o modelo otimizar a coisa errada com total competência técnica. Um modelo com 99,9% de acurácia num problema de detecção de fraude com 0,1% de fraudes pode ser o modelo que prevê "nunca é fraude" — perfeito pela métrica, inútil pelo negócio.

Por isso a primeira coisa a fazer numa pergunta de métrica é **perguntar sobre o custo dos erros**. Falso positivo e falso negativo quase nunca custam a mesma coisa, e a métrica certa é a que reflete essa assimetria.

### 1.2 Matriz de confusão — a base de tudo

Para classificação binária, com "positivo" sendo a classe de interesse (geralmente a rara: fraude, doença, churn):

|  | Previsto Positivo | Previsto Negativo |
|---|---|---|
| **Real Positivo** | TP (verdadeiro positivo) | FN (falso negativo) — *erro tipo II* |
| **Real Negativo** | FP (falso positivo) — *erro tipo I* | TN (verdadeiro negativo) |

Truque de memória que funciona sob pressão: o segundo termo é **o que o modelo disse**, o primeiro diz **se ele acertou**. "Falso positivo" = ele disse positivo, e foi falso.

Todas as métricas de classificação são funções dessas quatro células. Se você entender a matriz, você deriva qualquer métrica na hora e não precisa decorar nenhuma.

### 1.3 As métricas fundamentais

**Acurácia** = `(TP + TN) / total`. Fração de acertos. Intuitiva e quase sempre inadequada, porque trata os dois tipos de erro como equivalentes e é dominada pela classe majoritária.

**Precision (precisão / valor preditivo positivo)** = `TP / (TP + FP)`. *Das que eu marquei como positivas, quantas eram mesmo?* Denominador = **o que o modelo previu**. É a métrica que importa quando **agir sobre um positivo custa caro**: bloquear a transação de um cliente legítimo, enviar um caminhão, iniciar quimioterapia, mostrar um anúncio irrelevante.

**Recall (revocação / sensibilidade / TPR)** = `TP / (TP + FN)`. *Dos positivos que existiam, quantos eu peguei?* Denominador = **a realidade**. É a métrica que importa quando **deixar passar um positivo custa caro**: câncer não detectado, fraude que passou, falha de equipamento não prevista.

**Especificidade (TNR)** = `TN / (TN + FP)`. Recall da classe negativa. Aparece em contexto médico e é o complemento do FPR (`FPR = 1 - especificidade`).

**F1** = média harmônica de precision e recall = `2PR / (P + R)`. Usa-se média **harmônica** e não aritmética porque a harmônica pune desequilíbrio: com P=1.0 e R=0.0, a média aritmética daria 0.5 (parece razoável, mas o modelo é inútil) enquanto a F1 dá 0. F1 força as duas a serem decentes.

**F-beta** = `(1+β²)·P·R / (β²·P + R)`. Generaliza F1 permitindo ponderar. **β > 1 favorece recall** (F2 é comum em medicina e fraude), **β < 1 favorece precision** (F0.5). Regra de leitura: β é quantas vezes recall vale mais que precision. Citar F-beta em entrevista é um sinal forte, porque mostra que você entende que F1 embute a suposição — geralmente falsa — de que os dois erros custam o mesmo.

### 1.4 O trade-off precision-recall e o limiar

Ponto central e frequentemente mal compreendido: **a maioria dos classificadores produz um score contínuo, não uma classe.** A classe surge de comparar o score a um limiar (por padrão 0.5, que é uma convenção arbitrária, não uma escolha principiada).

Mover o limiar move você ao longo da curva precision-recall:

- **Limiar alto** → o modelo só marca positivo quando está muito confiante → **precision sobe, recall cai**.
- **Limiar baixo** → marca positivo facilmente → **recall sobe, precision cai**.

Consequência prática que impressiona: **"melhorar precision sem perder recall" exige um modelo melhor; só mexer no limiar apenas troca um pelo outro.** Se um entrevistador diz "a precision está baixa, o que você faz?", a primeira resposta é "subiria o limiar, mas isso custa recall — a pergunta certa é qual o custo relativo, e se nenhum ponto da curva é aceitável, aí sim preciso de um modelo melhor ou de features melhores."

**Como escolher o limiar de forma principiada:** atribua custos. Se um FN custa `C_FN` e um FP custa `C_FP`, o limiar ótimo de decisão em teoria da decisão é `C_FP / (C_FP + C_FN)`. Se um FN custa 10× um FP, o limiar ótimo é ~0.09 — bem longe de 0.5. Essa fórmula só é válida se o modelo estiver **calibrado** (ver 1.7), o que é uma boa deixa para o próximo assunto.

### 1.5 ROC-AUC vs PR-AUC — a pergunta que mais separa candidatos

**Curva ROC**: TPR (recall) no eixo Y contra FPR (`FP / (FP + TN)`) no eixo X, varrendo todos os limiares. **ROC-AUC** é a área sob ela.

A interpretação probabilística do AUC vale muito mais que a fórmula: **AUC é a probabilidade de que um exemplo positivo escolhido aleatoriamente receba um score maior que um exemplo negativo escolhido aleatoriamente.** Ou seja, AUC mede **qualidade de ordenação**, não qualidade de classificação. AUC = 0.5 é aleatório; AUC = 1.0 é separação perfeita; AUC < 0.5 significa que o modelo está ordenando ao contrário (inverta as previsões e você tem um modelo melhor que aleatório).

**Curva PR**: precision no eixo Y contra recall no eixo X. **PR-AUC** (≈ *average precision*) é a área sob ela.

**A diferença crítica, e é isto que o entrevistador quer:** o **FPR tem TN no denominador**. Quando os negativos são a esmagadora maioria, TN é gigantesco, e um número absurdo de falsos positivos mal move o FPR. Exemplo concreto: 1.000 positivos e 1.000.000 negativos. Se o modelo produz 10.000 falsos positivos, o FPR é 1% — a curva ROC continua parecendo ótima. Mas a precision é `1000/(1000+10000)` ≈ 9% — o modelo é inútil na prática, e a curva PR mostra isso imediatamente.

**Regra:** com forte desbalanceamento e quando a classe positiva rara é a que importa, **use PR-AUC**. ROC-AUC dá uma impressão otimista porque a métrica que ela usa no eixo X é diluída pela massa de negativos. Precision e recall **ignoram TN completamente**, e é exatamente por isso que servem melhor.

**Outra diferença que vale citar:** ROC-AUC é **invariante à prevalência** — se você reamostrar mudando a proporção de classes, o ROC-AUC não muda. PR-AUC **muda**. Isso é vantagem ou desvantagem conforme o que você quer: a invariância é boa para comparar o poder discriminativo do modelo entre populações com prevalências diferentes; é ruim quando você quer que a métrica reflita a realidade operacional, onde a prevalência importa muito. O baseline de um classificador aleatório em PR-AUC é a própria prevalência (0.001 no exemplo acima), enquanto em ROC-AUC é sempre 0.5.

### 1.6 Métricas de regressão

**MSE** = `(1/n)Σ(y - ŷ)²`. Penaliza erros grandes quadraticamente — **muito sensível a outliers**. Diferenciável em todo ponto e a otimização em forma fechada existe, que é a razão histórica de ser o padrão. Interpretação estatística: minimizar MSE estima a **média condicional** `E[y|x]`.

**RMSE** = `√MSE`. Mesma coisa, mas na unidade da variável-alvo, o que a torna comunicável ("erro típico de R$ 320").

**MAE** = `(1/n)Σ|y - ŷ|`. Penaliza linearmente, **robusto a outliers**. Minimizar MAE estima a **mediana condicional**. Essa é a distinção que vale ouro em entrevista: MSE e MAE não são "duas versões do mesmo erro" — elas estimam **estatísticas diferentes** da distribuição condicional. Se sua distribuição é assimétrica, elas produzem modelos sistematicamente diferentes, e a escolha é sobre qual estatística você quer.

**Huber loss** — quadrática perto de zero, linear longe. Compromisso: robusta a outliers como MAE, mas diferenciável em zero como MSE, o que ajuda a otimização.

**MAPE** = `(100/n)Σ|y-ŷ|/|y|`. Erro percentual, atraente porque é comparável entre escalas. **Três armadilhas:** explode quando `y` está perto de zero, é indefinida em `y = 0`, e é **assimétrica** — penaliza superestimar mais que subestimar (subestimar tem erro percentual máximo de 100%, superestimar é ilimitado). Isso enviesa modelos de previsão de demanda para baixo. Alternativas: sMAPE (menos assimétrica, mas com seus próprios problemas) ou **WAPE** (`Σ|y-ŷ| / Σ|y|`), que é o que mais se usa em forecasting de varejo por ser robusta a zeros e refletir volume.

**R²** = `1 - SS_res/SS_tot`. Fração da variância explicada. Ler com cuidado: R² **pode ser negativo** em dados de teste (significa pior que prever a média), e ele **nunca diminui** ao adicionar features no treino — daí o R² ajustado, que penaliza número de parâmetros. R² também é enganoso entre datasets: um R² de 0.3 pode ser excelente em predição de comportamento humano e péssimo em física.

**Nota sobre séries temporais:** compare sempre com um baseline ingênuo (`ŷ_t = y_{t-1}`, ou sazonal `ŷ_t = y_{t-s}`). É espantosamente comum um modelo sofisticado não bater o "amanhã será igual a hoje", e é a primeira coisa que um entrevistador experiente vai perguntar. MASE é a métrica que formaliza essa comparação.

### 1.7 Calibração — o diferencial

Um modelo é **calibrado** se, entre os exemplos aos quais ele atribui score 0.7, aproximadamente 70% são de fato positivos. Isso é **ortogonal à discriminação**: um modelo pode ter AUC de 0.95 (ordena perfeitamente) e ser totalmente descalibrado (todos os scores comprimidos entre 0.4 e 0.6).

**Quando calibração importa mais que ranking:** sempre que o score for usado como **probabilidade** numa decisão a jusante — cálculo de valor esperado, precificação de risco, `receita_esperada = p(clique) × valor`, ou aplicação de limiar por custo. Se você vai multiplicar o score por um valor monetário, ele **precisa** ser uma probabilidade de verdade. Se você só vai ordenar (mostrar os top-10), calibração é irrelevante e AUC basta.

**Como medir:** *reliability diagram* (binar os scores previstos e plotar a fração real de positivos contra o score médio do bin; a diagonal é a calibração perfeita), **ECE** (Expected Calibration Error — média ponderada dos desvios da diagonal) e **Brier score** (`média de (p - y)²` — uma *proper scoring rule*, que decompõe em calibração + refinamento).

**Como corrigir:** **Platt scaling** (ajustar uma regressão logística sobre os scores) ou **isotonic regression** (ajustar uma função monótona não-paramétrica; mais flexível, precisa de mais dados, tende a overfittar com poucos). Crucial: a calibração deve ser ajustada num **conjunto separado**, não no treino do modelo.

**Quem é naturalmente descalibrado:** SVMs (a saída não é probabilidade nenhuma), Naive Bayes (a suposição de independência empurra scores para os extremos 0 e 1), random forests (a média de votos comprime scores na direção do centro), e redes neurais modernas — que são notoriamente **superconfiantes**. Regressão logística treinada com log-loss é razoavelmente calibrada por construção, porque a log-loss é uma proper scoring rule.

**Armadilha muito boa para citar:** aplicar reamostragem para desbalanceamento (SMOTE, undersampling, class weights) **destrói a calibração**, porque muda a prevalência que o modelo enxerga. Os scores passam a refletir a distribuição reamostrada, não a real. Se você precisa de probabilidades, ou recalibre depois, ou corrija o intercepto analiticamente.

### 1.8 Multiclasse: micro, macro, weighted

Ao agregar precision/recall/F1 sobre K classes:

- **Macro** — calcula a métrica por classe e tira a **média simples**. Cada classe pesa igual, **independentemente do tamanho**. Use quando as classes raras importam tanto quanto as frequentes. É a que mais penaliza ignorar classes minoritárias.
- **Weighted** — média ponderada pelo suporte (nº de exemplos reais de cada classe). Dominada pelas classes grandes.
- **Micro** — agrega TP, FP, FN globalmente e calcula uma vez. **Em classificação multiclasse de rótulo único, micro-F1 = micro-precision = micro-recall = acurácia**, porque cada erro é simultaneamente um FP de uma classe e um FN de outra. Saber isso é um sinal claro de domínio; reportar "micro-F1" achando que é diferente de acurácia é um sinal claro do contrário.

### 1.9 Métricas de ranking (essenciais para busca e recomendação)

Quando a saída é uma **lista ordenada**, precision/recall globais não capturam o que importa: a **posição** do item relevante.

- **Precision@k / Recall@k** — restritos aos k primeiros. Simples e o que o negócio geralmente entende.
- **MAP** (Mean Average Precision) — média da precision calculada em cada posição de acerto. Considera ordem, mas trata relevância como binária.
- **NDCG** — o padrão. Usa ganho por relevância graduada com **desconto logarítmico por posição** (um acerto na posição 1 vale mais que na posição 10) e normaliza pelo ranking ideal, o que torna comparável entre consultas com números diferentes de itens relevantes.
- **MRR** — recíproco da posição do primeiro acerto. Apropriado quando existe essencialmente uma resposta certa (busca navegacional, QA).

---

## 2. Perguntas de entrevista

---

**🟢 Explique precision e recall. Quando você prioriza cada uma?**

**Resposta modelo:** Precision é, das previsões positivas, quantas estavam certas — o denominador é o que o modelo previu. Recall é, dos positivos reais, quantos o modelo encontrou — o denominador é a realidade.

Priorizo precision quando **agir sobre um falso positivo é caro**: bloquear a conta de um cliente legítimo, despachar um técnico, iniciar um tratamento invasivo. Priorizo recall quando **deixar passar um positivo é caro**: triagem de câncer, detecção de fraude de alto valor, falha crítica de equipamento.

Na prática eu não escolho no abstrato — pergunto o custo relativo dos dois erros e uso isso. Se um falso negativo custa 20× um falso positivo, isso define diretamente onde eu coloco o limiar. E o ponto de partida da conversa é que os dois se trocam mutuamente ao mover o limiar: melhorar um sem piorar o outro exige um modelo melhor, não um limiar diferente.

**Follow-up quase garantido:** *"Como você faria um modelo com 100% de recall?"* — Trivial e inútil: preveja positivo para tudo. Recall = 100%, precision = prevalência. É exatamente por isso que nenhuma das duas se reporta sozinha — sempre em par, ou via F-beta com o β justificado pelo custo dos erros.

---

**🟢 Sua acurácia é 99% num problema de detecção de fraude. É bom?**

**Resposta modelo:** Provavelmente não significa nada. Se a taxa de fraude é 1%, o modelo que prevê "nunca é fraude" tem 99% de acurácia e recall zero — completamente inútil. A primeira coisa que eu faria é comparar com esse baseline trivial da classe majoritária.

Eu olharia a matriz de confusão inteira e reportaria precision, recall e PR-AUC. Preferiria PR-AUC a ROC-AUC porque, com essa proporção, o FPR fica diluído pela massa de verdadeiros negativos e o ROC parece bom mesmo quando a precision é terrível. E antes disso tudo, eu perguntaria o custo relativo: quanto custa investigar uma transação legítima versus quanto custa uma fraude passar. É isso que define a métrica e o limiar, não a acurácia.

**Pegadinha frequente:** *"Então acurácia nunca serve?"* — Serve quando as classes são aproximadamente balanceadas **e** os erros custam parecido. Nesse caso ela é interpretável e comunica bem. O problema não é a acurácia em si, é usá-la sem checar essas duas condições.

---

**🟡 Qual a diferença entre ROC-AUC e PR-AUC? Quando você usa cada uma?**

**Resposta modelo:** ROC plota TPR contra FPR; PR plota precision contra recall. A diferença estrutural é que **FPR tem verdadeiros negativos no denominador e precision não tem**.

Isso importa muito sob desbalanceamento. Com 1.000 positivos e 1 milhão de negativos, dez mil falsos positivos dão um FPR de 1% — a curva ROC continua linda. Mas a precision é 9%: o modelo é inutilizável, e a curva PR mostra isso na hora. Então a regra que eu uso é: **classe positiva rara e é ela que importa → PR-AUC**; classes balanceadas ou os dois lados importam igualmente → ROC-AUC é adequado e tem a vantagem de ser mais estável.

Também vale saber que ROC-AUC é invariante à prevalência e PR-AUC não. Isso é bom para comparar poder discriminativo entre populações com prevalências diferentes, e ruim quando você quer que a métrica reflita a realidade operacional. O baseline aleatório de PR-AUC é a própria prevalência, enquanto o de ROC-AUC é sempre 0.5 — então um PR-AUC de 0.3 pode ser excelente se a prevalência é 1%.

**Follow-up:** *"O que AUC significa exatamente?"* — É a probabilidade de um positivo aleatório receber score maior que um negativo aleatório. Ou seja, mede **ordenação**, não classificação. Um modelo com AUC 0.95 e scores todos comprimidos entre 0.45 e 0.55 ordena perfeitamente e é péssimo como estimador de probabilidade.

**Follow-up 🔴:** *"AUC de 0.3 — o que aconteceu?"* — O modelo aprendeu a ordenação invertida, o que quase sempre indica bug: rótulos trocados, sinal invertido, ou eu passei a coluna errada como score positivo. Um modelo genuinamente aleatório daria 0.5. Curiosamente, inverter as previsões daria AUC 0.7 — o que confirma que há sinal, só está com o sinal trocado.

---

**🟡 O que é F1 e quando ele é a métrica errada?**

**Resposta modelo:** F1 é a média harmônica de precision e recall. É harmônica e não aritmética porque pune desequilíbrio: com precision 1.0 e recall 0.0, a aritmética daria 0.5 e a harmônica dá 0.

F1 é a métrica errada em três situações. Primeiro, **quando os erros têm custos diferentes** — F1 assume implicitamente que precision e recall valem o mesmo, o que quase nunca é verdade. Nesse caso uso F-beta com o β derivado do custo relativo. Segundo, **quando eu preciso de probabilidades e não de classes** — F1 exige um limiar fixado, então ele avalia o par (modelo, limiar), não o modelo; para comparar modelos independentemente do limiar, PR-AUC é melhor. Terceiro, **quando os verdadeiros negativos importam** — F1 os ignora completamente, então em um problema onde acertar a classe negativa tem valor, ele omite metade da história.

**Follow-up 🔴:** *"Você reporta F1 usando qual limiar?"* — Se eu escolho o limiar que maximiza F1 **no mesmo conjunto onde reporto**, estou overfittando o limiar e o número reportado é otimista. O correto é escolher o limiar na validação e reportar o F1 no teste com aquele limiar fixo. É um erro comum e ele infla resultados de forma silenciosa.

---

**🟡 Quando MAE é melhor que RMSE?**

**Resposta modelo:** Quando existem outliers que eu não quero que dominem o ajuste. RMSE penaliza quadraticamente, então um único erro grande pode pesar mais que centenas de erros pequenos, e o modelo vai se distorcer para acomodar aquele ponto.

A forma mais profunda de dizer isso é que as duas métricas estimam **estatísticas diferentes**: minimizar erro quadrático estima a **média condicional**, minimizar erro absoluto estima a **mediana condicional**. Em distribuições assimétricas — que é o caso de praticamente qualquer variável monetária — isso produz modelos sistematicamente diferentes, não só mais ou menos robustos. Então a pergunta certa não é "qual é mais robusta", é "eu quero prever a média ou a mediana?". Se eu vou somar as previsões (previsão de receita total), a média é o que soma corretamente e RMSE é apropriada. Se eu quero o caso típico, mediana e MAE.

Uso Huber quando quero robustez mas preciso de boa diferenciabilidade na otimização.

**Follow-up:** *"E MAPE?"* — Atraente por ser percentual e comparável entre escalas, mas com três problemas: indefinida em zero, explode perto de zero, e é assimétrica — penaliza superestimativa mais que subestimativa, porque subestimar tem erro máximo de 100% e superestimar é ilimitado. Isso enviesa previsões de demanda para baixo de forma sistemática. Em varejo eu preferiria WAPE, que é robusta a zeros e pondera por volume.

---

**🟡 O que é calibração e por que ela importa?**

**Resposta modelo:** Um modelo é calibrado se, dentre os exemplos aos quais ele dá score 0.7, cerca de 70% são realmente positivos. É ortogonal à discriminação: dá para ter AUC 0.95 e calibração horrível, porque AUC só olha ordenação e é invariante a qualquer transformação monótona dos scores.

Importa sempre que o score entra numa conta a jusante como se fosse probabilidade: valor esperado, precificação de risco, decisão por custo, `lance = p(conversão) × margem`. Se eu multiplico um score descalibrado por dinheiro, o resultado é lixo mesmo com um modelo que ordena bem. Se eu só vou ordenar e mostrar os top-N, calibração não importa.

Meço com reliability diagram, ECE ou Brier score. Corrijo com Platt scaling ou isotonic regression, sempre ajustados num conjunto separado. Vale saber quem é naturalmente descalibrado: SVM não produz probabilidade nenhuma, Naive Bayes empurra scores para os extremos por causa da suposição de independência, random forest comprime na direção do centro, e redes neurais modernas são notoriamente superconfiantes.

**Follow-up 🔴 excelente:** *"Você aplicou SMOTE. O que acontece com a calibração?"* — Quebra. A reamostragem muda a prevalência que o modelo enxerga, então os scores passam a refletir a distribuição artificial e não a real — superestimam sistematicamente a probabilidade da classe positiva. Se eu preciso de probabilidades, recalibro depois num conjunto com a prevalência real, ou corrijo o intercepto analiticamente pelo log-odds da razão de reamostragem.

---

**🟡 Multiclasse: qual a diferença entre macro-F1, micro-F1 e weighted-F1?**

**Resposta modelo:** Macro calcula F1 por classe e tira a média simples — cada classe pesa igual independente do tamanho, então classes raras têm o mesmo peso das frequentes. É o que eu uso quando as classes minoritárias importam. Weighted pondera pelo suporte, então as classes grandes dominam. Micro agrega TP, FP e FN globalmente antes de calcular.

O ponto que vale destacar: em classificação multiclasse de rótulo único, **micro-F1 é numericamente igual à acurácia**, porque cada erro conta simultaneamente como um falso positivo de uma classe e um falso negativo de outra. Então reportar micro-F1 achando que traz informação nova sobre desbalanceamento é um erro — não traz. Se o problema é desbalanceamento, macro é a métrica que expõe isso.

Em multi-rótulo (onde um exemplo pode ter várias classes), micro e acurácia deixam de coincidir e micro passa a ser informativa.

---

**🟡 Como você escolhe o limiar de classificação?**

**Resposta modelo:** Não uso 0.5 por padrão — é uma convenção, não uma escolha. Escolho por um dos três caminhos, na ordem de preferência.

**Por custo:** se eu tenho os custos de FP e FN, o limiar ótimo de decisão é `C_FP / (C_FP + C_FN)`. Se um FN custa 10× um FP, o limiar é cerca de 0.09. Isso só é válido se o modelo estiver calibrado, então eu verifico a calibração antes.

**Por restrição operacional:** frequentemente o negócio impõe capacidade — a equipe de fraude consegue investigar 200 casos por dia. Aí o limiar é definido pelo percentil que gera 200 alertas, e a métrica relevante vira precision@200.

**Por otimização de métrica:** escolher o limiar que maximiza F-beta na curva PR. Crucial fazer isso **no conjunto de validação** e reportar no teste com o limiar já fixo — caso contrário o número reportado está inflado.

Em produção, eu monitoraria esse limiar, porque a distribuição de scores desloca com o tempo e um limiar fixo produz volumes de alerta muito diferentes conforme o drift.

---

**🔴 Seu modelo tem AUC 0.85 offline mas o negócio diz que ele não funciona. Como investiga?**

**Resposta modelo:** Trataria como uma discrepância entre a métrica e o objetivo, e checaria em ordem:

**A métrica não é o objetivo.** AUC mede ordenação sobre toda a faixa de scores, mas o negócio pode operar só nos top-1%. Um modelo pode ter AUC ótimo e desempenho ruim na cauda que importa. Eu recalcularia precision@k na faixa operacional real.

**Desbalanceamento mascarando.** Com positivos raros, AUC 0.85 pode conviver com precision de 5%. Reportaria PR-AUC e a curva de precision no volume de alertas que eles realmente processam.

**Calibração.** Se eles usam o score numa conta de valor esperado, um modelo descalibrado destrói a decisão mesmo ordenando bem.

**Leakage ou split inválido.** AUC bom demais offline com desempenho ruim online é a assinatura clássica de leakage ou de validação temporalmente inválida. Verificaria se o split respeitou o tempo e se alguma feature contém informação do futuro.

**Distribuição de produção diferente.** O conjunto de teste pode não representar o tráfego real — período diferente, filtros de amostragem, população diferente.

**Feedback loop / seleção.** Se o modelo antigo já filtrava casos, o dado de treino só contém o que passou pelo filtro, então a avaliação é sobre uma população enviesada e não sobre o tráfego que o modelo verá.

**O modelo é bom mas o processo não usa ele bem.** Latência alta demais, alertas chegando tarde, o time ignorando o score. Métrica boa não sobrevive a um processo ruim, e é surpreendentemente comum ser esta a causa.

A conclusão que eu daria: a métrica offline precisa ser redesenhada para espelhar a decisão real, e o teste definitivo é um A/B online com métrica de negócio.

---

**🔴 Como você avalia um sistema de recomendação?**

**Resposta modelo:** Em três camadas, e a resposta ruim é ficar só na primeira.

**Offline, métricas de ranking:** NDCG@k é o padrão porque considera relevância graduada e desconta por posição; Precision@k e Recall@k para comunicação com o negócio; MRR quando existe essencialmente uma resposta certa. Métricas de classificação globais são inadequadas porque ignoram posição, e posição é o produto inteiro.

**Offline, métricas além da acurácia:** cobertura de catálogo, diversidade intra-lista, novidade, e a distribuição de exposição entre itens. Um recomendador que só recomenda os 100 itens mais populares tem NDCG decente e mata o negócio no médio prazo pelo colapso da cauda longa.

**Online, que é o que decide:** A/B test com métricas de negócio — CTR, conversão, tempo de sessão, retenção. E aqui está o ponto mais importante: **métricas offline de recomendação são notoriamente pouco correlacionadas com resultado online**, porque os dados offline são enviesados pelo sistema atual (você só observa feedback de itens que o sistema antigo mostrou — *presentation bias*). Então offline serve para descartar candidatos ruins e o A/B decide.

Eu também alertaria sobre o alvo: otimizar CTR de curto prazo costuma degradar satisfação de longo prazo (clickbait). A métrica de decisão deveria ser retenção ou valor de sessão, com CTR como métrica secundária de diagnóstico.

**Follow-up:** *"Como avalia o cold start?"* — Segmentando a avaliação: métricas separadas para usuários novos, itens novos e a cauda longa. A métrica agregada esconde falhas de cold start porque usuários frequentes dominam o volume.

---

**🔴 Quando ROC-AUC pode ser enganoso mesmo com classes balanceadas?**

**Resposta modelo:** Alguns casos.

**Quando só uma região da curva importa.** AUC integra sobre todos os limiares, inclusive regiões que você nunca vai operar. Dois modelos podem ter o mesmo AUC com curvas que se cruzam: um melhor em FPR baixo, outro em FPR alto. Se eu opero em FPR baixo, o AUC agregado esconde exatamente a diferença que decide. Nesse caso uso **AUC parcial** na região de interesse, ou reporto TPR num FPR fixo.

**Quando o custo dos erros é assimétrico.** AUC trata todos os pontos da curva como igualmente relevantes, o que equivale a assumir uma distribuição implícita de custos que provavelmente não é a sua.

**Quando eu preciso de probabilidades.** AUC é invariante a qualquer transformação monótona dos scores, então é literalmente cego a calibração.

**Quando há dependência entre exemplos.** Se o conjunto de teste tem múltiplas amostras do mesmo usuário ou paciente, o AUC é otimista porque o modelo pode estar reconhecendo o indivíduo, não a condição. Isso pede agrupamento no split e, idealmente, AUC calculado por grupo.

---

## 3. Armadilhas comuns

**Reportar acurácia sem comparar com o baseline da classe majoritária.** É o erro mais eliminatório do tópico. Sempre diga qual seria a acurácia de prever sempre a classe mais comum.

**Confundir os denominadores de precision e recall.** Precision divide pelo que o modelo previu; recall divide pelo que existe na realidade. Trocar isso na entrevista é fatal porque é o conceito mais básico.

**Usar ROC-AUC sob desbalanceamento severo.** O FPR é diluído pela massa de TN. Use PR-AUC.

**Achar que AUC alto significa boas probabilidades.** AUC mede ordenação e é invariante a transformações monótonas. Não diz nada sobre calibração.

**Otimizar limiar no conjunto de teste.** Infla o resultado. Limiar é hiperparâmetro: escolhe-se na validação.

**Reportar F1 sem dizer o limiar.** F1 avalia o par (modelo, limiar). Sem o limiar o número não é reproduzível nem comparável.

**Reportar micro-F1 em multiclasse achando que é diferente de acurácia.** Em rótulo único, são iguais.

**Usar MAPE com valores próximos de zero.** Explode e é assimétrica. Prefira WAPE ou MAE.

**Comparar R² entre datasets diferentes.** R² depende da variância da variável-alvo naquele dataset. 0.3 pode ser excelente ou terrível dependendo do domínio.

**Esquecer que reamostragem quebra calibração.** SMOTE, undersampling e class weights alteram a prevalência aprendida. Recalibre se precisar de probabilidades.

**Avaliar sistema de ranking com métricas de classificação.** Ignora posição, que é o que o produto inteiro é.

**Não comparar séries temporais com o baseline ingênuo.** Se o modelo não bate "amanhã = hoje", não há nada a celebrar.

**Escolher métrica antes de perguntar o custo dos erros.** É a diferença entre um candidato que responde a pergunta e um que responde a pergunta certa.
