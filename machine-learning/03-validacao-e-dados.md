# 03 — Validação e Dados

> Train/val/test, cross-validation, data leakage, validação temporal, desbalanceamento de classes.
> Este é o tópico que **mais** distingue quem já trabalhou com ML de verdade de quem só treinou modelos em datasets limpos. Leakage é a pergunta favorita de entrevistadores sênior porque é impossível de responder bem sem ter sido queimado por ele.

---

## 1. Resumo conceitual

### 1.1 Por que separar dados

Você quer estimar o desempenho do modelo em dados que ele nunca viu. Qualquer dado que influenciou o modelo — no ajuste dos parâmetros, na escolha de hiperparâmetros, na seleção de features, na decisão de arquitetura — está contaminado e não serve para essa estimativa. Isso é mais amplo do que parece: **toda decisão tomada olhando um conjunto de dados consome a virgindade daquele conjunto.**

Os três papéis:

- **Treino** — ajusta os parâmetros do modelo.
- **Validação** — escolhe hiperparâmetros, seleciona modelo, define limiar, decide quando parar (early stopping).
- **Teste** — estima o desempenho final. **Usado uma vez, no fim.**

O teste é sagrado precisamente porque cada olhada nele o transforma progressivamente em validação. Se você testa 50 configurações no conjunto de teste e escolhe a melhor, aquele número é otimista: você selecionou o que teve sorte naquela amostra específica. Esse fenômeno tem nome — *overfitting por seleção de modelo*, ou o problema das comparações múltiplas aplicado a ML.

Proporções típicas: 60/20/20 ou 70/15/15 para datasets de porte médio. Com milhões de amostras, 98/1/1 é perfeitamente razoável, porque 1% de 10 milhões são 100 mil exemplos — mais que suficiente para uma estimativa precisa. **O que importa é o tamanho absoluto dos conjuntos de avaliação, não a porcentagem.** Essa observação é um bom sinal em entrevista.

### 1.2 Cross-validation

Com dados escassos, um único split de validação é ruidoso: sua estimativa depende de quais exemplos calharam de cair na validação. **k-fold cross-validation** divide os dados em k partes, treina k vezes usando k-1 partes e validando na restante, e agrega os k resultados.

Vantagens: usa todos os dados para treino e validação (em rodadas diferentes), e — o que mais importa e menos se fala — **fornece uma estimativa da variabilidade**, não só um ponto. Reportar "0.84 ± 0.03" em vez de "0.84" muda a conversa: se dois modelos diferem em 0.01 e o desvio entre folds é 0.03, a diferença é ruído e escolher o "melhor" é superstição.

Custo: k vezes mais treinos.

**Escolha de k.** k=5 e k=10 são padrão. k maior → cada treino usa mais dados → estimativa com menos bias, mas mais custo e os folds ficam mais correlacionados entre si (os conjuntos de treino se sobrepõem quase totalmente), o que aumenta a variância da média estimada. **LOOCV** (k=n) tem bias mínimo e variância alta, além de ser caro — na prática raramente é a melhor escolha, exceto com pouquíssimos dados.

**Variantes que você precisa saber:**

- **Stratified k-fold** — preserva a proporção de classes em cada fold. **Deve ser o padrão em classificação**, especialmente com desbalanceamento, senão um fold pode não ter nenhum exemplo da classe rara.
- **Group k-fold** — garante que todas as amostras de um mesmo grupo (usuário, paciente, sessão, dispositivo) fiquem no mesmo fold. Obrigatório sempre que houver múltiplas linhas por entidade, senão o modelo memoriza a entidade e a estimativa é otimista.
- **Time series split** — folds sequenciais no tempo, sempre treinando no passado e validando no futuro (ver 1.4).
- **Repeated k-fold** — repete o k-fold com embaralhamentos diferentes, reduzindo o ruído da partição. Útil com datasets pequenos.
- **Nested CV** — CV interna para escolher hiperparâmetros, externa para estimar desempenho. É o jeito correto de obter uma estimativa não-enviesada quando você faz muita busca de hiperparâmetros. Caro (k_ext × k_int treinos), mas é a resposta tecnicamente correta para "como você evita overfittar na validação?".

### 1.3 Data leakage — o tópico mais importante deste arquivo

**Leakage é qualquer informação disponível no treino que não estará disponível no momento da predição real.** Ele produz métricas offline espetaculares e falha total em produção. A assinatura é sempre a mesma: *resultado bom demais*.

Regra de ouro que resolve a maioria dos casos: **congele mentalmente o instante da predição e pergunte, para cada feature, "eu teria esse valor, com esse conteúdo, naquele instante?"**

**Os tipos, em ordem de frequência:**

**1. Leakage de pré-processamento (o mais comum).** Ajustar qualquer transformação usando o dataset inteiro antes de dividir. Padronizar com a média/desvio global vaza estatísticas do teste para o treino. O mesmo vale para: imputação de missing pela média global, seleção de features usando correlação com o alvo calculada em tudo, PCA ajustado em tudo, target encoding, discretização por quantis, e reamostragem. **A correção é sempre a mesma: divida primeiro, ajuste (`fit`) apenas no treino, aplique (`transform`) nos demais.** Um pipeline que encapsula as transformações junto com o modelo torna isso automático dentro de CV — se você citar isso, mostra que sabe como o erro é evitado na prática, não só que ele existe.

**2. Leakage temporal.** Usar informação do futuro para prever o passado. Split aleatório em dados temporais é o caso clássico: você treina com dezembro e valida com junho. Também aparece de forma sutil em features agregadas ("média de compras do cliente") calculadas sobre todo o histórico, incluindo o período que você está prevendo.

**3. Leakage de alvo (target leakage).** Uma feature que é consequência do alvo, não causa. Exemplos reais: `valor_indenização` num modelo de previsão de sinistro (só é preenchido se houve sinistro); `numero_de_visitas_ao_oncologista` prevendo câncer; `data_de_cancelamento` prevendo churn; `status_da_conta = 'bloqueada'` prevendo fraude. Sintoma clássico: **uma única feature com importância dominante e AUC próximo de 1**.

**4. Leakage de grupo/duplicata.** O mesmo indivíduo, sessão ou item aparecendo em treino e teste. O modelo reconhece a entidade, não o padrão. Muito comum em dados médicos (múltiplos exames do mesmo paciente), em imagens (frames do mesmo vídeo) e em dados web (múltiplas linhas do mesmo usuário). Duplicatas exatas ou quase-exatas entre treino e teste são a versão mais grosseira.

**5. Leakage por reamostragem antes do split.** Aplicar SMOTE antes de dividir faz com que exemplos sintéticos gerados a partir de pontos de treino apareçam no teste — o modelo já viu quase exatamente aquele ponto. Regra: **reamostragem é parte do treino, sempre depois do split, e nunca aplicada ao conjunto de validação/teste.**

**6. Leakage por seleção de features fora do CV.** Escolher as top-100 features por correlação com o alvo usando todos os dados e depois fazer CV. A seleção já viu os folds de validação. Em datasets com muitas features e poucas amostras, isso sozinho produz AUC de 0.9 a partir de ruído puro — é um resultado clássico e conhecido em genômica.

**Como detectar leakage na prática:**

- Desempenho **suspeito de tão bom** para a dificuldade conhecida do problema.
- **Uma feature dominando** a importância. Investigue a semântica e a origem dela, não a estatística.
- **Discrepância grande entre offline e produção** — o sintoma que aparece tarde demais.
- **Ablação:** remova a feature suspeita; se a métrica desaba de 0.97 para 0.72, você achou.
- **Auditoria de dicionário de dados:** para cada feature, quando ela é escrita no sistema de origem? Se for escrita depois do evento que você prevê, é leakage.
- **Teste com dados de um período futuro real** — o teste mais honesto que existe.

### 1.4 Validação temporal

Se o objetivo é prever o futuro, **a validação deve simular prever o futuro**. Split aleatório em série temporal é sempre errado, por três razões: quebra a dependência temporal, usa o futuro para prever o passado, e ignora que a distribuição muda com o tempo (não-estacionariedade).

**Esquemas corretos:**

**Rolling forward / walk-forward** — múltiplos folds, cada um treinando num período e validando no período imediatamente seguinte. Duas variantes:

- **Janela expansiva:** o treino cresce a cada fold (usa todo o histórico). Melhor quando o processo é razoavelmente estável e mais dados ajudam.
- **Janela deslizante:** o treino tem tamanho fixo e desliza. Melhor quando há drift forte e dados antigos atrapalham mais do que ajudam.

**Gap / embargo** — deixar um intervalo entre o fim do treino e o começo da validação. Necessário quando (a) o alvo tem horizonte (você prevê o que acontece nos próximos 30 dias, então rótulos perto da borda dependem de dados dentro do período de validação) ou (b) há autocorrelação forte. Sem o gap, há vazamento sutil na fronteira. Isso é padrão em finanças e é um detalhe que impressiona.

**Ponto sutil e muito bom para citar:** em validação temporal, os folds mais recentes são os mais representativos do que virá. Fazer a média simples de todos os folds pode mascarar que o modelo vem degradando. **Olhe a série de métricas por fold, não só a média** — uma tendência decrescente é um sinal de concept drift que a média esconde.

**Outro ponto:** ao treinar o modelo final para produção, você retreina com **todos** os dados, incluindo o período de validação. A validação serviu para estimar desempenho e escolher hiperparâmetros; jogar fora os dados mais recentes seria absurdo justamente porque são os mais relevantes.

### 1.5 Desbalanceamento de classes

Primeiro: **desbalanceamento não é automaticamente um problema.** É um problema quando (a) a classe rara é a que importa e (b) o modelo aprende a ignorá-la. Com sinal forte e dados suficientes, um modelo aprende classes raras sem intervenção. A pergunta certa é "o modelo está detectando a classe rara?", não "as classes estão balanceadas?".

O que o desbalanceamento realmente causa: com pouquíssimos exemplos positivos, o gradiente da classe majoritária domina e o mínimo da perda fica perto de "prever sempre a majoritária". **O problema profundo é quantidade absoluta de exemplos da classe rara, não a proporção.** 1% de 10 milhões são 100 mil positivos e isso é bastante; 1% de 1.000 são 10 positivos e nenhuma técnica salva isso.

**Abordagens, em ordem do que eu tentaria:**

**1. Mudar a métrica e o limiar (sempre primeiro).** Muitas vezes o "problema de desbalanceamento" é só um problema de olhar acurácia e usar limiar 0.5. Trocar para PR-AUC e escolher o limiar por custo resolve sem tocar nos dados. **Esta é a resposta que separa um bom candidato: reamostragem não deveria ser o primeiro reflexo.**

**2. Class weights / cost-sensitive learning.** Pesar a perda inversamente à frequência da classe. Vantagem sobre reamostragem: não duplica nem descarta dados, é uma linha de configuração, e é matematicamente mais limpo. Em XGBoost/LightGBM, `scale_pos_weight`; em muitos estimadores do scikit-learn, `class_weight='balanced'`. É o meu padrão.

**3. Undersampling da majoritária.** Descarta informação, mas é barato e acelera treino. Faz sentido quando a majoritária é enorme e redundante. Variantes informadas (Tomek links, NearMiss) removem exemplos seletivamente.

**4. Oversampling da minoritária.** Duplicar exemplos aumenta o risco de overfitting nos exemplos duplicados. **SMOTE** gera exemplos sintéticos interpolando entre vizinhos da classe minoritária, o que é melhor que duplicar. Limitações do SMOTE que valem citar: funciona mal em alta dimensão (a interpolação em espaço esparso gera pontos em regiões implausíveis), não funciona bem com features categóricas (há a variante SMOTE-NC), e pode interpolar entre um ponto minoritário e um vizinho que na verdade é ruído, criando exemplos sintéticos dentro do território da classe majoritária e borrando a fronteira.

**5. Coletar mais dados da classe rara**, se possível. Sempre a melhor opção quando viável.

**6. Reformular como detecção de anomalia**, quando a classe rara é rara demais (<0.1%) ou heterogênea demais para ser modelada como classe. Ver [09](09-nao-supervisionado.md).

**Regras não-negociáveis sobre reamostragem:**

- **Somente no treino.** Nunca no teste ou na validação — eles devem refletir a distribuição real, senão sua métrica não significa nada operacionalmente.
- **Dentro do CV, não antes.** Reamostrar antes de fazer CV vaza exemplos sintéticos entre folds.
- **Ela quebra a calibração.** Os scores passam a refletir a prevalência artificial. Recalibre se precisar de probabilidades.

### 1.6 Distribuição de val/teste

Uma regra que vale ouro em entrevista: **validação e teste devem vir da mesma distribuição, e essa distribuição deve ser a de produção.** Se o modelo vai rodar em fotos de celular de baixa qualidade, não valide em fotos profissionais.

Corolário útil: quando os dados de treino abundantes vêm de uma fonte e os dados que importam vêm de outra escassa, o correto **não** é misturar tudo e dividir aleatoriamente. É colocar os dados da distribuição-alvo em val/teste (e um pouco no treino), e usar a fonte abundante só no treino. Isso permite diagnosticar separadamente overfitting de *data mismatch* — para o qual se usa um conjunto extra ("train-dev"), retirado da distribuição de treino e não usado para treinar: se o erro sobe de treino para train-dev, é variância; se sobe de train-dev para val, é mismatch de distribuição.

---

## 2. Perguntas de entrevista

---

**🟢 Por que dividir em treino, validação e teste? Por que não só treino e teste?**

**Resposta modelo:** Porque cada decisão tomada olhando um conjunto contamina esse conjunto. O treino ajusta parâmetros. A validação escolhe hiperparâmetros, seleciona o modelo, define o limiar e decide quando parar. Se eu usar o teste para essas escolhas, ele deixa de ser uma estimativa imparcial: eu estaria escolhendo a configuração que teve sorte naquela amostra específica, e o número reportado seria otimista.

O caso extremo torna óbvio: se eu testo 100 modelos no conjunto de teste e reporto o melhor, aquele resultado é essencialmente o máximo de 100 amostras ruidosas, não o desempenho esperado. O teste tem que ser usado uma vez, no fim.

**Follow-up:** *"Que proporção você usa?"* — 70/15/15 ou 60/20/20 como padrão, mas o que importa é o **tamanho absoluto** dos conjuntos de avaliação. Com 10 milhões de amostras, 98/1/1 é ótimo, porque 100 mil exemplos já dão uma estimativa precisa e é melhor usar o resto para treinar. Com 500 amostras, nenhum split fixo é confiável e eu iria para cross-validation repetida.

---

**🟢 O que é cross-validation e por que usar?**

**Resposta modelo:** Dividir os dados em k partes, treinar k vezes usando k-1 partes e validando na restante, e agregar. Uso quando os dados são escassos, por dois motivos. Primeiro, todos os exemplos são usados tanto para treinar quanto para validar, em rodadas diferentes, o que aproveita melhor dados limitados. Segundo — e isso é o que mais uso na prática — ele dá uma **estimativa da variabilidade**, não só um número. Reportar 0.84 ± 0.03 muda decisões: se dois modelos diferem em 0.01 e o desvio entre folds é 0.03, a diferença é ruído e escolher o "melhor" é superstição.

O custo é k vezes mais treinos, então em deep learning com treinos caros eu costumo usar um holdout único bem dimensionado.

**Follow-up:** *"k=5 ou k=10?"* — k maior significa mais dados por treino, portanto menos bias na estimativa, mas mais custo e folds mais correlacionados entre si, o que aumenta a variância da média. 5 e 10 são os padrões razoáveis; LOOCV tem bias mínimo mas variância alta e custo proibitivo, e só considero com dados muito escassos.

**Follow-up:** *"Sempre uso k-fold simples?"* — Não. Em classificação uso **stratified**, para garantir a proporção de classes em cada fold — sem isso, com desbalanceamento, um fold pode não ter nenhum positivo. Se há múltiplas linhas por entidade, uso **group k-fold**. Em série temporal, k-fold aleatório é inválido e uso split temporal.

---

**🟡 O que é data leakage? Dê exemplos e diga como você detecta.**

**Resposta modelo:** Leakage é ter no treino alguma informação que não estará disponível no momento real da predição. O resultado é métrica offline excelente e falha em produção.

Os tipos que mais vejo: **pré-processamento** — padronizar ou imputar usando estatísticas do dataset inteiro antes de dividir, o que vaza informação do teste; **temporal** — split aleatório em dados com tempo, treinando em dezembro para prever junho; **target leakage** — uma feature que é consequência do alvo, como `valor_da_indenização` num modelo de previsão de sinistro, que só é preenchido quando houve sinistro; e **leakage de grupo** — o mesmo paciente ou usuário em treino e teste, fazendo o modelo reconhecer a entidade em vez do padrão.

Detecto por sinais: resultado bom demais para a dificuldade conhecida do problema, uma feature dominando a importância, e discrepância entre offline e online. A investigação decisiva é semântica, não estatística: para cada feature suspeita, eu pergunto **quando aquele campo é escrito no sistema de origem**. Se é escrito depois do evento que estou prevendo, é leakage. Confirmo por ablação: remover a feature e ver se a métrica desaba.

A prevenção estrutural é encapsular todo o pré-processamento num pipeline que é ajustado dentro de cada fold, para que seja impossível ajustar em dados de validação por descuido.

**Follow-up muito comum:** *"Onde exatamente você aplica o StandardScaler?"* — Ajusto (`fit`) somente no treino e aplico (`transform`) em validação e teste com os parâmetros do treino. Dentro de CV, isso precisa acontecer **dentro de cada fold**, não uma vez antes — por isso o pipeline. Ajustar antes do CV é o leakage mais comum que existe e é sutil porque o efeito costuma ser pequeno e não levanta suspeita.

**Follow-up 🔴:** *"O efeito de padronizar antes do split é grande?"* — Geralmente pequeno, e é exatamente por isso que é perigoso: ele não gera um resultado absurdo que te alerta, só um viés otimista silencioso. Fica grave com datasets pequenos, com features de cauda pesada, e com transformações mais agressivas como target encoding ou seleção de features, onde o efeito pode ser enorme.

---

**🟡 Como você valida um modelo de série temporal?**

**Resposta modelo:** Nunca com split aleatório. Uso validação walk-forward: múltiplos folds, cada um treinando num período e validando no período imediatamente seguinte, sempre passado → futuro. Escolho entre janela expansiva, que acumula todo o histórico e é melhor quando o processo é estável, e janela deslizante de tamanho fixo, melhor quando há drift forte e dados antigos atrapalham.

Duas coisas que eu adicionaria e que costumam ser esquecidas. Primeiro, **um gap entre treino e validação** quando o alvo tem horizonte — se eu prevejo o que acontece nos próximos 30 dias, os rótulos perto da borda do treino dependem de dados que caem dentro da validação, e sem o gap há vazamento na fronteira. Segundo, **olhar a série de métricas por fold e não só a média**: se o desempenho vem caindo nos folds mais recentes, isso é concept drift e a média esconde. Os folds recentes são os mais representativos do que vai acontecer.

Também tomo cuidado com features agregadas: uma média histórica por cliente precisa ser calculada usando apenas dados anteriores ao ponto de predição, o que na prática significa agregações com janela e ponto de corte, não `groupby` sobre a tabela inteira.

E, para produção, retreino com todos os dados incluindo o período de validação — jogar fora os dados mais recentes seria perder justamente os mais relevantes.

---

**🟡 Como você lida com desbalanceamento de classes?**

**Resposta modelo:** Primeiro eu questionaria se é de fato um problema. Desbalanceamento só importa se a classe rara é a que interessa e se o modelo está de fato ignorando ela. Com sinal forte e volume absoluto suficiente, modelos aprendem classes raras sem intervenção — 1% de 10 milhões são 100 mil positivos, o que é bastante. O problema real é **quantidade absoluta**, não proporção.

Na ordem que eu tentaria: **primeiro mudar a métrica e o limiar** — muita coisa que se chama "problema de desbalanceamento" é só usar acurácia com limiar 0.5. Trocar para PR-AUC e escolher o limiar pelo custo dos erros frequentemente resolve sem tocar nos dados. **Segundo, class weights** — pesar a perda inversamente à frequência, que é mais limpo que reamostrar porque não duplica nem descarta dados. **Terceiro, reamostragem** — undersampling se a majoritária for enorme e redundante, SMOTE se eu precisar de mais sinal da minoritária. **Quarto, coletar mais dados da classe rara.** E se a classe for rara demais ou heterogênea demais, eu reformularia como detecção de anomalia.

As regras que não quebro: reamostragem só no treino, nunca em validação e teste, porque eles precisam refletir a distribuição real; dentro do CV e não antes; e sabendo que ela **quebra a calibração** — se eu precisar de probabilidades, recalibro depois.

**Follow-up:** *"Quando SMOTE falha?"* — Em alta dimensão, porque interpolar em espaço esparso gera pontos em regiões implausíveis do espaço de features; com categóricas, porque interpolação não faz sentido — precisa da variante SMOTE-NC; e quando há ruído na classe minoritária, porque interpolar a partir de um outlier gera exemplos sintéticos dentro do território da majoritária, borrando a fronteira. Em muitos casos práticos class weights performa igual ou melhor com muito menos complexidade.

---

**🟡 Você tem AUC de 0.98 offline e 0.62 em produção. O que aconteceu?**

**Resposta modelo:** Essa magnitude de queda é quase sempre leakage ou split inválido, não drift. Eu investigaria em ordem de probabilidade:

**Leakage de alvo** — alguma feature que só existe depois do evento. Verificaria a importância das features e a semântica de qualquer uma dominante, checando quando aquele campo é escrito no sistema de origem.

**Split temporal inválido** — se o split foi aleatório mas o problema é temporal, o modelo viu o futuro. Refaria a avaliação com walk-forward.

**Leakage de grupo** — o mesmo usuário em treino e teste, com o modelo memorizando entidades.

**Leakage de pré-processamento** — transformações ajustadas antes do split.

**Diferença de distribuição** — o conjunto offline não representa o tráfego real: filtros de amostragem, período diferente, ou viés de seleção do sistema anterior, onde eu só tenho rótulos para os casos que o sistema antigo deixou passar.

**Disponibilidade de features em produção** — uma feature que existe no data warehouse mas chega tarde ou vem nula em tempo real. Esse é sutil e muito comum: o valor está lá offline, mas no momento da inferência ainda não foi computado.

O teste diagnóstico mais rápido: treinar num período e avaliar num período posterior real. Se a métrica cai para perto de 0.62, o problema é a validação; se continua alta, o problema está na engenharia de serving ou nas features em tempo real.

---

**🔴 Como você evita overfittar no conjunto de validação?**

**Resposta modelo:** É um problema real e subestimado: se eu testo centenas de configurações contra o mesmo conjunto de validação, acabo selecionando o que teve sorte naquela amostra. É o problema das comparações múltiplas aplicado à seleção de modelos, e o resultado é que a estimativa de validação fica otimista mesmo o teste estando intocado.

Mitigações, da mais barata à mais correta:

**Limitar o número de comparações** e preferir busca aleatória ou bayesiana a grid exaustivo — menos avaliações, menos chance de sorte.

**Usar CV em vez de holdout único** para a seleção, o que reduz a variância do critério de escolha.

**Regra do erro-padrão:** entre modelos cujo desempenho está dentro de um erro-padrão do melhor, escolher o **mais simples**. Isso reconhece explicitamente que diferenças dentro do ruído não são diferenças.

**Nested cross-validation:** CV interna para escolher hiperparâmetros, externa para estimar desempenho. É a resposta formalmente correta, porque a estimativa externa nunca viu a seleção. Caro, mas é o que eu usaria se o número reportado tivesse consequência séria.

**Reservar um teste realmente intocado** e olhá-lo uma vez só. Se ele discorda muito da validação, isso é a evidência de que eu overfittei a validação.

**Follow-up:** *"Como você sabe que overfittou a validação?"* — Discrepância entre validação e teste, e o padrão suspeito de o melhor modelo mudar de posição com pequenas perturbações do split. Se reembaralhar os folds troca qual configuração vence, eu estava escolhendo ruído.

---

**🔴 Você está prevendo churn. Descreva o desenho completo de treino e validação.**

**Resposta modelo:** Começaria definindo o problema com precisão, porque é aqui que a maioria dos erros nasce.

**Definição de churn e horizonte.** "Churn" precisa de uma definição operacional: não usar o produto por 30 dias? cancelar a assinatura? Sem isso não há rótulo. E preciso do horizonte de predição: prevejo churn nos próximos 30 dias a partir de hoje? Essa escolha define tudo o mais.

**Ponto de corte e construção do rótulo.** Para cada cliente escolho um instante de referência `T`. Todas as features usam **exclusivamente** dados até `T`. O rótulo é se ele deu churn no intervalo `(T, T + 30 dias]`. Isso torna explícito o que é passado e o que é futuro — a fonte número um de leakage aqui é calcular features agregando o histórico inteiro, incluindo o período do rótulo.

**Split temporal, não aleatório.** Treino com pontos de referência até uma data, validação num período posterior, teste num período ainda posterior. E com **gap de pelo menos 30 dias** entre treino e validação, porque rótulos perto da borda do treino dependem de eventos dentro do período de validação.

**Agrupamento por cliente.** Se o mesmo cliente aparece em múltiplos pontos de referência, ele não pode estar em treino e teste. Combino split temporal com agrupamento por cliente.

**Leakage a auditar explicitamente:** qualquer campo preenchido pela equipe de retenção (`contato_de_retencao`, `oferta_de_desconto`), porque ele é consequência de alguém já ter percebido o risco de churn, não causa; campos de status atualizados no cancelamento; e tickets de suporte abertos depois de `T`.

**Desbalanceamento.** Churn mensal costuma ser 2–5%. Usaria PR-AUC como métrica principal e escolheria o limiar pela capacidade da equipe de retenção — se eles conseguem contatar 500 clientes por mês, a métrica que importa é precision@500, e ainda melhor seria ponderar por valor do cliente, porque salvar um cliente grande vale mais.

**Avaliação final.** A pergunta real do negócio não é "quem vai dar churn" e sim "em quem vale a pena intervir", que é um problema de **uplift** — nem todo cliente com alto risco é influenciável pela intervenção, e alguns clientes só cancelam *porque* foram contatados. Se houver orçamento, eu proporia um teste com grupo de controle para medir o efeito causal da intervenção, e não só a acurácia da previsão. Essa distinção entre predição e efeito causal é o que faz o projeto dar retorno de verdade.

---

**🔴 Quando cross-validation é uma má ideia?**

**Resposta modelo:** Vários casos.

**Dados temporais** — k-fold aleatório usa o futuro para prever o passado e produz estimativa inválida, geralmente otimista. Usar walk-forward.

**Dados agrupados sem group-aware CV** — múltiplas amostras por entidade fazem o modelo memorizar a entidade.

**Custo de treino proibitivo** — treinar um modelo grande 10 vezes pode ser inviável. Nesse caso, um holdout único bem dimensionado é o compromisso razoável, aceitando maior variância na estimativa.

**Dados muito pequenos com alta variância entre folds** — CV com poucos exemplos gera estimativas tão ruidosas que decisões baseadas nelas são arbitrárias. Ajuda usar k-fold repetido, mas o problema de fundo é falta de dados e nenhuma técnica de validação cria informação.

**Quando o pré-processamento é caro e não pode ser refeito por fold** — aí a tentação é ajustar uma vez antes, o que introduz leakage. Se não dá para fazer certo, holdout é preferível a um CV enviesado.

**Quando existe dependência espacial** — dados geográficos vizinhos são correlacionados; split aleatório superestima. Precisa de CV com blocos espaciais.

**E um caso conceitual:** quando a pergunta não é "qual o desempenho esperado" e sim "esse modelo específico funciona nesta população específica". CV estima o desempenho do *procedimento* de treino, não de um modelo em particular — cada fold produz um modelo diferente. Para validar um artefato específico que vai para produção, você precisa de um holdout que aquele artefato nunca viu.

---

## 3. Armadilhas comuns

**Ajustar transformações antes do split.** O leakage mais comum e mais silencioso. `fit` só no treino, e dentro de cada fold do CV.

**Split aleatório em dados temporais.** Invalida a estimativa inteira. E o modelo parece ótimo, o que torna o erro difícil de perceber.

**Ignorar agrupamento.** Mesmo usuário/paciente/sessão em treino e teste. Use group k-fold.

**Reamostrar antes do split.** Exemplos sintéticos derivados do treino aparecem no teste.

**Reamostrar o conjunto de teste.** O teste tem que refletir a distribuição real ou a métrica não significa nada operacionalmente.

**Usar o teste múltiplas vezes.** Cada olhada o transforma em validação. Se você já olhou muitas vezes, seja honesto sobre isso ao reportar.

**Reportar a métrica média do CV sem o desvio.** Sem a variabilidade, não dá para saber se a diferença entre modelos é real.

**Assumir que desbalanceamento sempre exige reamostragem.** Frequentemente métrica correta + limiar correto + class weights resolvem melhor e mais simples.

**Achar que SMOTE "cria informação".** Ele interpola dentro do que já existe. Não adiciona sinal novo; muda o formato do problema de otimização.

**Esquecer que reamostragem quebra calibração.**

**Otimizar hiperparâmetros no teste.** Mesmo "só uma olhadinha" para escolher entre duas opções contamina.

**Não checar disponibilidade das features em tempo de inferência.** Feature que existe no warehouse mas chega tarde em produção é leakage disfarçado de engenharia.

**Usar k-fold não estratificado em classificação desbalanceada.** Alguns folds podem ficar sem exemplos da classe rara.

**Achar que CV valida o modelo final.** CV valida o *procedimento*. O modelo que vai para produção é outro artefato e precisa de um holdout próprio ou de monitoramento em produção.
