# 04 — Batch vs Streaming, Processamento em Tempo Real e Semânticas de Entrega

> Batch vs streaming · Event time vs processing time · Watermarks e late data · Janelas · At-least-once, at-most-once, exactly-once · Event-driven · Lambda e Kappa

---

## 1. Resumo conceitual

### 1.1 A distinção real entre batch e streaming

A definição comum — "batch processa em lotes, streaming processa contínuo" — é verdadeira mas rasa. A distinção que importa numa entrevista é sobre **limites**:

**Batch processa um conjunto de dados delimitado (bounded).** Você sabe onde ele começa e onde termina. Isso permite luxos enormes: reordenar tudo, ver o dataset inteiro antes de decidir, fazer múltiplas passadas, reprocessar do zero de forma barata, e falhar e recomeçar sem consequência.

**Streaming processa um fluxo ilimitado (unbounded).** Não existe "o fim". Isso significa que você nunca tem o conjunto completo, precisa produzir resultados incrementais, precisa decidir **quando** considerar um resultado pronto (sem nunca ter certeza de que não chegará mais nada), e precisa manter estado através de falhas porque não pode recomeçar do zero.

Essa é a razão de streaming ser mais difícil, e é o insight que faz uma boa resposta. Não é que o dado chega mais rápido — é que você tem que tomar decisões com informação incompleta, para sempre.

Uma formulação elegante que vale conhecer: **batch é um caso especial de streaming** (um stream com fim conhecido). É a tese por trás de engines unificadas como Apache Beam e do Structured Streaming do Spark, onde a mesma API expressa os dois. O inverso não é verdadeiro.

**Micro-batch** é o meio-termo: processar lotes muito pequenos em intervalos curtos (segundos). É como o Spark Structured Streaming funciona por padrão. Dá latência de segundos com um modelo de execução mais simples e throughput alto. Streaming "verdadeiro" (registro a registro, como Flink) chega a latência de milissegundos ao custo de mais complexidade. Saber que existe esse espectro — e que a escolha é sobre latência versus simplicidade — é melhor que tratar batch e streaming como binário.

### 1.2 Quando usar cada um (a parte que decide a resposta)

A pergunta certa não é "batch ou streaming", é **"qual é o custo de o dado estar desatualizado por N minutos?"**

Se ninguém age sobre o dado em menos de um dia — relatório mensal, dashboard consultado de manhã, treino de modelo semanal — streaming é custo sem retorno. Batch é mais barato, mais simples de operar, mais fácil de reprocessar e de testar.

Streaming se justifica quando existe uma **ação com valor decaindo no tempo**: detecção de fraude (bloquear antes de aprovar), recomendação em sessão, alerta operacional, precificação dinâmica, monitoramento de sistemas, ou quando o próprio produto expõe dados em tempo real ao usuário.

Um argumento secundário, mas legítimo: streaming pode ser mais barato que batch quando o volume é altíssimo e o processamento contínuo evita picos de compute gigantes em janelas curtas. E há o caso de a origem *ser* um stream — se o dado já vem de Kafka, consumir em streaming pode ser mais simples que orquestrar micro-batches.

**O custo real do streaming**, que candidatos subestimam:
- Estado precisa ser mantido, versionado e recuperado em falhas.
- Reprocessamento é muito mais difícil: reprocessar um mês de stream exige releitura do log com retenção suficiente, e resultados podem diferir por questões de ordem e timing.
- Testar é mais difícil: o comportamento depende de tempo e de ordem de chegada.
- Debugar em produção é mais difícil: não há "a tabela do dia" para inspecionar.
- Operação 24/7: um job de streaming que cai às 3h da manhã acumula lag, e o lag tem que ser recuperado.
- Mudança de lógica: fazer deploy de nova versão de um job com estado exige migração de estado ou reprocessamento.

Numa entrevista, reconhecer explicitamente que **streaming tem custo operacional muito maior** e que a maioria dos casos de uso não precisa dele é um sinal forte de senioridade. Muitos candidatos tratam streaming como "melhor", quando é apenas diferente e mais caro.

### 1.3 Event time vs processing time — o conceito mais cobrado

**Processing time**: o instante em que o sistema processou o registro.
**Event time**: o instante em que o evento realmente aconteceu, no mundo.
(Existe ainda o **ingestion time**: quando o evento entrou no sistema de mensageria — um meio-termo usado por conveniência.)

Eles divergem sempre, e às vezes muito: um app mobile offline pode enviar eventos com horas ou dias de atraso; uma partição de Kafka pode acumular lag; um retry pode reordenar mensagens.

**Por que event time é quase sempre o correto para análise:** se você conta "vendas por hora" usando processing time, um atraso no pipeline move vendas da hora 14 para a hora 15, e o resultado passa a descrever o *seu sistema*, não o negócio. Pior: o resultado deixa de ser reprodutível — reprocessar o mesmo dado em outro momento dá números diferentes. Com event time, o resultado é determinístico e reflete a realidade.

**O preço de usar event time** é que você nunca sabe se todos os eventos de uma janela já chegaram. Isso leva direto ao próximo conceito.

### 1.4 Watermarks e late data

Um **watermark** é a afirmação do sistema de que "provavelmente já vi todos os eventos com event time anterior a T". É uma heurística sobre completude, não uma garantia.

Ele resolve o dilema fundamental do streaming: você precisa fechar a janela em algum momento para emitir o resultado, mas fechar cedo demais perde dados e fechar tarde demais aumenta a latência e o custo de manter estado. O watermark é o botão que controla esse trade-off, e ele é explícito e configurável justamente porque a resposta certa depende do negócio.

Na prática, o watermark costuma ser derivado do maior event time visto menos uma tolerância configurada (por exemplo, "maior event time − 10 minutos"). Quando o watermark passa do fim de uma janela, a janela é considerada completa, o resultado é emitido e o estado pode ser descartado.

**Late data** é o evento que chega depois de o watermark já ter passado sua janela. Opções de tratamento:

1. **Descartar.** Simples, e aceitável quando a fração é minúscula e o impacto é irrelevante. Precisa ser **medido**, não assumido — instrumentar a contagem de eventos descartados é obrigatório.
2. **Enviar para um side output / dead letter** e processar em batch depois. Padrão pragmático e muito usado.
3. **Atualizar o resultado retroativamente.** Reabrir a janela e reemitir. Exige que o destino suporte update e que os consumidores tolerem números que mudam. Caro em estado, porque exige manter janelas abertas por mais tempo (o `allowedLateness` do Flink, o modo update do Spark).
4. **Reprocessamento em batch periódico** que corrige o resultado do streaming — que é exatamente a ideia da arquitetura Lambda.

**O trade-off do watermark**, que é a resposta que impressiona: watermark curto significa latência baixa e mais dados perdidos; watermark longo significa latência alta, mais estado retido (mais memória e mais custo) e menos perda. Não existe valor certo — existe uma decisão de negócio sobre quanto atraso é tolerável versus quanto de perda é tolerável. Dizer isso explicitamente é melhor do que citar um número.

### 1.5 Janelas (windowing)

Como agregar um fluxo infinito? Recortando-o em janelas.

- **Tumbling (fixa)**: intervalos fixos e não sobrepostos. "A cada 5 minutos." Cada evento pertence a exatamente uma janela. É o caso mais comum.
- **Sliding (deslizante)**: intervalos fixos com sobreposição. "Últimos 10 minutos, atualizado a cada 1 minuto." Cada evento pertence a várias janelas — o que significa mais estado e mais compute. Usado para médias móveis e detecção de tendência.
- **Session**: janela definida por inatividade. "Agrupa eventos do mesmo usuário até que ele fique 30 minutos sem atividade." Tamanho variável, definido pelos dados. Fundamental para analytics de comportamento.
- **Global**: uma única janela para todo o stream, fechada por um trigger customizado. Usada quando a lógica de agrupamento não é temporal.

Um detalhe frequentemente cobrado: janelas deslizantes com muita sobreposição multiplicam o estado. Uma janela de 24 horas deslizando a cada minuto significa que cada evento participa de 1440 janelas. Isso pode ser inviável, e a alternativa costuma ser agregação incremental sobre janelas menores.

### 1.6 Semânticas de entrega — o tópico onde mais gente erra

**At-most-once**: cada mensagem é entregue zero ou uma vez. Pode perder, nunca duplica. Implementado ao commitar o offset **antes** de processar. Aceitável para métricas de telemetria de alto volume onde perder 0,1% não muda nada, e onde latência importa mais que completude.

**At-least-once**: cada mensagem é entregue uma ou mais vezes. Nunca perde, pode duplicar. Implementado ao commitar o offset **depois** de processar com sucesso — se falhar entre processar e commitar, a mensagem é reprocessada. É o padrão da indústria, porque perder dado normalmente é pior que duplicar.

**Exactly-once**: cada mensagem afeta o resultado final exatamente uma vez.

**E aqui está o ponto que separa candidatos:** exactly-once **delivery** é impossível em sistemas distribuídos, num sentido teórico rigoroso — é o problema dos dois generais. Você nunca pode ter certeza absoluta de que a mensagem chegou sem um ack, e o ack pode se perder. O que os sistemas realmente oferecem é **exactly-once processing semantics** (EOS): a mensagem pode ser *entregue* várias vezes, mas o **efeito** sobre o estado e sobre a saída acontece uma vez só.

Isso é obtido combinando três mecanismos:
1. **Deduplicação na entrada** (o produtor idempotente do Kafka atribui um ID e um número de sequência por partição, e o broker descarta duplicatas de retry).
2. **Estado e offsets commitados atomicamente** — a atualização do estado do processamento e o avanço do offset acontecem na mesma transação, então nunca ficam dessincronizados.
3. **Escrita transacional ou idempotente no destino** — o sink precisa participar, seja com transação (Kafka como destino, via transações), seja com escrita idempotente (upsert por chave).

**O elo mais fraco é sempre o sink.** Se o destino não participa da transação e não é idempotente — uma API externa, um arquivo em append, um e-mail — não há exactly-once, por mais que o framework prometa. O Kafka oferece EOS de ponta a ponta apenas quando origem e destino são Kafka (padrão read-process-write), ou quando o sink externo suporta transações ou idempotência via chave.

**A conclusão prática, e a melhor resposta possível para esta pergunta:** na maioria dos sistemas reais, você implementa **at-least-once + idempotência no destino**, e o resultado observável é equivalente a exactly-once, com muito menos complexidade e melhor performance. Exactly-once nativo custa throughput (transações adicionam coordenação e latência) e reduz as opções de arquitetura. Dizer isso mostra que você entende o conceito, não só o vocabulário.

### 1.7 Event-driven e arquiteturas

**Event-driven** significa que componentes reagem a eventos publicados em vez de serem chamados diretamente. O produtor não sabe quem consome. Isso desacopla os sistemas: adicionar um consumidor novo não exige mudar o produtor.

Dois estilos que valem distinguir:
- **Event notification**: o evento diz que algo aconteceu, e o consumidor busca os detalhes. Payload pequeno, mas gera chamadas de volta à origem e acopla temporalmente.
- **Event-carried state transfer**: o evento carrega o estado necessário. O consumidor não precisa consultar ninguém. Payload maior, mas desacoplamento real — e é o que permite ao consumidor reconstruir seu estado relendo o log.

**Event sourcing** é mais radical: o log de eventos **é** a fonte de verdade, e o estado atual é uma projeção derivada dele. Permite reconstruir qualquer estado passado e criar novas visões relendo o histórico. O custo é complexidade alta e a necessidade de lidar com evolução de schema de eventos ao longo de anos.

**CQRS** (Command Query Responsibility Segregation) separa o modelo de escrita do modelo de leitura, frequentemente combinado com event sourcing. Vale conhecer o nome; raramente é o foco de uma entrevista de dados.

**Arquitetura Lambda**: duas camadas paralelas — uma batch, que reprocessa tudo e produz a verdade, e uma speed/streaming, que dá resultado aproximado com baixa latência. A camada de serving combina as duas. Resolve o problema de correção versus latência, mas o custo é manter **duas implementações da mesma lógica**, em linguagens e frameworks diferentes, que precisam concordar. Divergência entre elas é a fonte clássica de bugs.

**Arquitetura Kappa**: só streaming. Reprocessamento é feito relendo o log desde o início com a nova versão do código. Elimina a duplicação de lógica, ao custo de exigir retenção longa no log e um sistema de streaming maduro o suficiente para servir também como camada de reprocessamento em alto throughput.

A visão contemporânea: com engines unificadas (Beam, Structured Streaming, Flink) e formatos de tabela que suportam upsert e time travel, a distinção Lambda/Kappa perdeu força — você escreve uma lógica que roda nos dois modos sobre a mesma tabela. Mas o problema conceitual que Lambda tentava resolver (resultado aproximado agora versus correto depois) continua real, e frequentemente a solução prática é streaming produzindo o resultado corrente mais um job de reconciliação em batch corrigindo periodicamente — que é Lambda em espírito, com implementação compartilhada.

### 1.8 Estado, checkpointing e recuperação

Um job de streaming com agregação mantém **estado** (as contagens parciais das janelas abertas, o estado de sessão por usuário, as tabelas de join). Se o job cair, esse estado precisa sobreviver.

**Checkpoint** é a persistência periódica e consistente do estado mais a posição de leitura no stream. Na recuperação, o job retoma do último checkpoint e reprocessa a partir dali. Isso é o que torna at-least-once possível, e — quando combinado com commit transacional — o que torna EOS possível.

O algoritmo clássico é o **Chandy-Lamport** (snapshot distribuído assíncrono), usado pelo Flink através de barreiras que fluem pelo grafo de operadores, permitindo capturar um estado global consistente sem parar o processamento.

Pontos práticos que aparecem em perguntas avançadas:
- **Frequência do checkpoint** é um trade-off: mais frequente significa menos reprocessamento na recuperação, mas mais overhead constante.
- **Estado grande é um problema em si.** Um job com dezenas de GB de estado tem checkpoints lentos e recuperação lenta. Backends de estado que gravam em disco local com upload incremental (RocksDB no Flink) existem por isso.
- **Mudança de código com estado** é dolorosa: se você altera a estrutura do estado, o checkpoint antigo pode ficar incompatível. Savepoints (checkpoints explícitos e versionados) existem para migração planejada.
- **TTL de estado** é obrigatório em qualquer job que mantém estado por chave (por exemplo, sessões por usuário). Sem expiração, o estado cresce para sempre e o job morre — normalmente semanas depois de entrar em produção, quando ninguém está olhando.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Qual a diferença entre processamento batch e streaming?**

*Resposta modelo:* Batch processa um conjunto delimitado — você sabe onde começa e termina, pode ver tudo antes de decidir, fazer múltiplas passadas e reprocessar do zero barato. Streaming processa um fluxo ilimitado: nunca existe o conjunto completo, então você produz resultados incrementais, tem que decidir quando considerar uma janela pronta sem ter certeza de que não chega mais nada, e tem que manter estado através de falhas.

Essa é a razão de streaming ser mais difícil: não é a velocidade, é ter que decidir com informação permanentemente incompleta.

---

**🟢 P2. Quando você escolheria streaming em vez de batch?**

*Resposta modelo:* Quando existe uma ação cujo valor decai rapidamente com o tempo: detecção de fraude que precisa bloquear antes de aprovar, recomendação dentro da sessão, alerta operacional, precificação dinâmica. Se ninguém age sobre o dado em menos de um dia, streaming é custo sem retorno.

E o custo é grande: estado para manter e recuperar, reprocessamento muito mais difícil, testes mais complexos, e operação 24/7. Por padrão eu iria de batch e só migraria o que tivesse justificativa de negócio clara.

---

**🟢 P3. O que é event time e processing time?**

*Resposta modelo:* Event time é quando o evento aconteceu no mundo real; processing time é quando o sistema o processou. Eles divergem sempre — app offline, lag na fila, retry. Para análise, event time é quase sempre o correto: se você agrega por processing time, um atraso no seu pipeline move vendas de uma hora para outra, e o resultado passa a descrever o seu sistema em vez do negócio. Além disso, resultado por event time é reprodutível — reprocessar dá o mesmo número; por processing time, não.

---

**🟢 P4. O que são at-least-once e at-most-once?**

*Resposta modelo:* At-most-once entrega zero ou uma vez: pode perder, nunca duplica. Na prática é commitar o offset antes de processar. At-least-once entrega uma ou mais vezes: nunca perde, pode duplicar. É commitar o offset depois de processar com sucesso. At-least-once é o padrão da indústria, porque perder dado é geralmente pior que duplicar — e duplicata pode ser resolvida com idempotência no destino.

---

### 🟡 Intermediário

**🟡 P5. O que é um watermark e qual o trade-off de configurá-lo?**

*Resposta modelo:* Watermark é a afirmação do sistema de que provavelmente já viu todos os eventos com event time anterior a um instante T. É heurística, não garantia. Serve para decidir quando fechar uma janela e emitir o resultado, já que num stream infinito você nunca tem certeza de completude.

O trade-off é direto: watermark curto dá latência baixa mas descarta mais dados atrasados; watermark longo captura mais dados mas atrasa o resultado e retém mais estado, o que custa memória e dinheiro. Não existe valor certo — é uma decisão de negócio sobre quanto atraso é aceitável versus quanta perda é aceitável. O que eu sempre faço é instrumentar a contagem de eventos descartados por atraso, para que essa decisão seja baseada em medida e não em suposição.

---

**🟡 P6. Explique os tipos de janela em streaming.**

*Resposta modelo:* Tumbling são intervalos fixos sem sobreposição — cada evento cai em exatamente uma janela, e é o caso mais comum. Sliding são intervalos fixos com sobreposição, tipo "últimos 10 minutos atualizados a cada minuto" — cada evento cai em várias janelas, o que multiplica estado e compute. Session são definidas por inatividade: agrupa eventos de uma chave até um gap de N minutos sem atividade, com tamanho variável definido pelos dados — é o que se usa para analytics de comportamento. E global, uma janela única fechada por trigger customizado.

O detalhe prático: janela deslizante com muita sobreposição é uma armadilha de custo. Uma janela de 24 horas deslizando a cada minuto coloca cada evento em 1440 janelas. Nesse caso costuma valer mais agregar incrementalmente sobre janelas menores e compor.

---

**🟡 P7. Exactly-once é possível? Explique.**

*Resposta modelo:* Exactly-once *delivery* é impossível num sentido rigoroso — é o problema dos dois generais: você nunca tem certeza de que a mensagem chegou sem ack, e o ack pode se perder. O que os sistemas oferecem é exactly-once *processing semantics*: a mensagem pode ser entregue várias vezes, mas o efeito sobre o estado e sobre a saída acontece uma vez.

Isso exige três coisas juntas: deduplicação na entrada (no Kafka, o produtor idempotente com PID e número de sequência por partição); estado e offset commitados atomicamente, para nunca ficarem dessincronizados; e um sink que participe da transação ou seja idempotente.

O elo fraco é sempre o sink. Se o destino é uma API externa não idempotente, não existe exactly-once, por mais que o framework prometa. Por isso, na maioria dos sistemas reais, a solução prática é at-least-once mais idempotência no destino — o resultado observável é o mesmo, com muito menos complexidade e melhor throughput.

*Follow-up muito comum:* "Por que exactly-once custa throughput?" → Porque transações exigem coordenação: o coordenador de transação, os marcadores de commit/abort no log, e o fato de consumidores em modo `read_committed` só poderem ler até o ponto em que não há transação aberta pendente. Isso adiciona latência e reduz o paralelismo efetivo.

---

**🟡 P8. O que é late data e como você lida com ela?**

*Resposta modelo:* É o evento que chega depois de o watermark já ter passado a janela dele. Quatro tratamentos possíveis, e escolho pelo impacto.

Descartar, quando a fração é minúscula e o impacto irrelevante — mas isso tem que ser medido, não assumido. Mandar para um side output ou dead letter e processar em batch depois, que é o pragmático e o que uso mais. Reabrir a janela e reemitir o resultado corrigido, o que exige que o destino aceite update e que os consumidores tolerem números que mudam — e custa estado, porque as janelas ficam abertas mais tempo. Ou corrigir com um job batch periódico, que é a ideia da arquitetura Lambda.

A pergunta que eu faria ao negócio antes de decidir é: um número que muda depois é aceitável, ou é pior que um número ligeiramente incompleto? Em relatório financeiro a resposta costuma ser oposta à de um dashboard operacional.

---

**🟡 P9. O que é checkpointing e por que é necessário?**

*Resposta modelo:* É a persistência periódica e consistente do estado do job junto com a posição de leitura no stream. É necessário porque um job de streaming com agregação mantém estado — janelas abertas, sessões, tabelas de join — e se o processo cair sem ter persistido isso, o estado se perde e não há como recomeçar sem reler tudo desde o início.

Na recuperação, o job retoma do último checkpoint e reprocessa a partir dali, o que é exatamente o que produz at-least-once. Se o commit do estado e do offset for atômico, você chega a exactly-once processing.

O trade-off é a frequência: checkpoint mais frequente reduz o reprocessamento na recuperação mas adiciona overhead constante. E estado grande é um problema em si — checkpoint lento, recuperação lenta — o que motiva backends que gravam em disco local com upload incremental, como o RocksDB no Flink.

---

### 🔴 Avançado

**🔴 P10. Descreva a arquitetura Lambda e a Kappa. Qual você escolheria hoje?**

*Resposta modelo:* Lambda mantém duas camadas: uma batch que reprocessa tudo e produz o resultado correto, e uma de streaming que dá um resultado aproximado com baixa latência; a camada de serving combina as duas. Resolve o conflito entre correção e latência, mas o custo é manter duas implementações da mesma lógica, frequentemente em frameworks diferentes. Elas divergem, e essa divergência é a fonte clássica de bugs — alguém compara os dois números, eles não batem, e ninguém sabe qual está certo.

Kappa elimina a camada batch: só streaming, e reprocessamento é reler o log desde o início com a nova versão do código. Uma lógica só. Exige retenção longa no log e um sistema de streaming maduro o bastante para aguentar reprocessamento em alto throughput, que é uma carga bem diferente do regime normal.

Hoje eu não escolheria nenhuma das duas como dogma. Com engines unificadas e formatos de tabela com upsert e time travel, você escreve uma lógica que roda nos dois modos sobre a mesma tabela — o que captura o benefício do Kappa (uma implementação) sem exigir que o streaming carregue todo o peso do reprocessamento histórico. Na prática, o padrão que eu defendo é streaming produzindo o resultado corrente e um job batch de reconciliação corrigindo periodicamente. É Lambda em espírito, mas com a lógica compartilhada, que era o problema real.

---

**🔴 P11. Seu job de streaming acumulou 6 horas de lag durante a madrugada. O que você faz e como evita que se repita?**

*Resposta modelo:* Primeiro diagnóstico, antes de qualquer ação: o lag é uniforme entre partições ou concentrado em algumas? Se está concentrado, é **data skew** ou uma partição com consumidor morto, e escalar não resolve. Se é uniforme, é capacidade ou uma degradação externa.

Verifico as causas mais comuns nessa ordem: um sink externo lento ou degradado (o mais frequente — o job não está lento, está esperando); crescimento do estado deixando o processamento e os checkpoints lentos; um pico legítimo de volume; ou GC pressure / falta de recursos.

Para recuperar: se a origem retém o suficiente, escalo o paralelismo temporariamente para drenar. Mas atenção — em Kafka, o paralelismo máximo é o número de partições, então adicionar consumidores além disso não ajuda em nada. Se o gargalo for o sink, escalar o consumidor só piora. E se o processamento tiver janelas por event time, drenar rápido pode disparar emissão de muitas janelas de uma vez, com pico de carga no destino.

Uma decisão que precisa ser explícita: **recuperar tudo ou pular para o presente?** Se o consumo alimenta um alerta operacional, dado de 6 horas atrás não tem valor e pode ser melhor pular para o fim e reprocessar o buraco em batch. Se alimenta uma tabela transacional, tem que recuperar tudo, em ordem.

Para evitar: alerta sobre **consumer lag** (não sobre "job está rodando" — o job estava rodando o tempo todo), com limiar baseado em tempo e não em número de mensagens; monitoramento separado da latência do sink; TTL no estado; testes de carga com volume de pico; e capacidade dimensionada com folga para picos, já que streaming não tem a elasticidade natural que o batch tem.

---

**🔴 P12. Você precisa fazer um join entre dois streams. Quais são os desafios?**

*Resposta modelo:* Join entre streams é um dos problemas mais difíceis de streaming, por três razões.

**Estado ilimitado.** Para juntar A com B, você precisa reter registros de A esperando os de B. Como o stream é infinito, sem limite isso cresce para sempre. A solução é um **interval join** ou **window join**: definir que A só junta com B dentro de uma janela temporal (por exemplo, ±5 minutos de event time), o que permite descartar estado antigo. Isso significa aceitar que pares fora da janela nunca serão emitidos — uma perda deliberada, que precisa ser dimensionada com o negócio.

**Ordem de chegada e assimetria.** Os dois streams podem ter lags diferentes. Se A chega em tempo real e B com 10 minutos de atraso, seu watermark efetivo é o do stream mais atrasado, e a latência do resultado é ditada pelo pior dos dois.

**Semântica do resultado.** Um inner join emite só quando os dois lados chegam. Um outer join precisa decidir *quando* desistir de esperar o outro lado — o que só é decidível via watermark, e significa que uma linha com NULL pode ser emitida e depois "corrigida" se o par chegar atrasado.

Um caso especial muito mais tratável é o **stream-table join** (enriquecer eventos com dados de referência): aqui um dos lados é uma tabela relativamente estática, mantida como estado local ou consultada externamente. É comum e bem suportado — em Kafka Streams via KTable, no Flink via lookup join ou broadcast state. A pergunta importante nesse caso é **temporal**: você quer juntar com o valor atual da tabela ou com o valor vigente no event time do evento? A segunda é a correta para reprocessamento determinístico e é o que **temporal table join** resolve, mas exige versionar a tabela de referência.

Na prática, quando o join é complexo, vale perguntar se ele precisa mesmo ser em streaming. Frequentemente enriquecer com um lookup e deixar o join pesado para o batch é a resposta mais barata e correta.

---

**🔴 P13. Como você garantiria exactly-once de ponta a ponta num pipeline Kafka → processamento → banco relacional?**

*Resposta modelo:* Vou por partes, porque cada elo precisa de uma garantia diferente.

**Produtor → Kafka:** habilitar o produtor idempotente. O broker atribui um PID e rastreia número de sequência por partição, descartando duplicatas de retry. Isso elimina duplicação causada por reenvio do produtor. Se o produtor escreve em múltiplas partições ou tópicos como uma unidade, uso transações.

**Kafka → processamento:** o consumidor não pode commitar offset antes de processar. Além disso, offset e estado precisam avançar juntos.

**Processamento → banco relacional:** aqui está o elo decisivo, e é onde a resposta se define. Um banco relacional não participa da transação do Kafka, então não existe commit atômico entre os dois. Duas saídas viáveis:

*A que eu prefiro:* **escrita idempotente no destino**. Cada registro carrega uma chave de idempotência determinística, e a escrita é um `MERGE`/upsert por essa chave. Aí o pipeline roda em at-least-once, duplicatas são absorvidas pelo upsert, e o resultado observável é exactly-once. Simples, performático, e não depende de nenhuma coordenação exótica.

*A alternativa:* **transação no destino que grava o dado e o offset na mesma transação**, numa tabela de controle de offsets no próprio banco. Na recuperação, o job lê o offset do banco em vez do Kafka. Isso dá atomicidade real entre "processei" e "avancei", porque as duas informações vivem no mesmo sistema transacional. É o padrão two-phase-ish mais robusto sem transação distribuída de verdade.

O que eu **não** faria é assumir que ligar exactly-once no framework resolve. A garantia é sempre limitada pelo elo mais fraco, e num sink externo o framework não tem como impor nada.

---

**🔴 P14. Um stakeholder pede "dados em tempo real" para um dashboard. Como você conduz essa conversa?**

*Resposta modelo:* "Tempo real" quase nunca significa o que a pessoa diz. Eu faria três perguntas antes de qualquer discussão técnica.

**Qual decisão você toma com esse dado, e em quanto tempo?** Se a resposta é "olho de manhã para acompanhar", a latência necessária é horas, não segundos. Se é "se cair abaixo de X eu paro a campanha", aí sim há urgência, e o que ele quer na verdade é um **alerta**, não um dashboard — e alerta é muito mais barato de construir.

**O que acontece se o número estiver 15 minutos desatualizado? E 1 hora?** Isso transforma um requisito vago numa curva de custo versus valor, e frequentemente revela que a exigência era estética.

**O número pode mudar depois de exibido?** Streaming com late data produz números que se corrigem retroativamente. Muita gente pede tempo real e depois reclama que o valor de ontem mudou. É melhor descobrir isso antes.

Depois disso eu apresentaria o custo com honestidade: micro-batch a cada 5–15 minutos resolve a maioria dos casos com uma fração da complexidade de streaming verdadeiro, e frequentemente é uma mudança de agendamento em vez de uma nova arquitetura. Streaming real implica operação 24/7, reprocessamento difícil e um custo contínuo.

Se depois disso a necessidade se confirmar, eu construo. O ponto não é resistir ao pedido — é garantir que a complexidade que vou operar pelos próximos anos esteja pareada com valor real, e que quem pediu entenda o que está comprando.

---

**🔴 P15. O que acontece quando você precisa mudar a lógica de um job de streaming com estado que está em produção?**

*Resposta modelo:* É um dos pontos mais dolorosos de streaming, e a resposta depende do tipo de mudança.

**Mudança que não afeta a estrutura do estado** (ajustar um filtro, mudar um campo de saída): faço um savepoint — um checkpoint explícito e versionado — paro o job, subo a nova versão restaurando daquele savepoint. Downtime curto e sem perda.

**Mudança que altera a estrutura do estado** (novo campo na agregação, mudança de chave, mudança de tipo de janela): o estado antigo pode ser incompatível. Opções: escrever código de migração de estado, quando o framework suporta evolução de schema de estado; ou aceitar reprocessar, subindo o novo job desde um offset anterior no log e descartando o estado antigo — o que só é possível se a retenção do log cobrir a janela necessária.

**Mudança que altera resultados históricos:** aí precisa de um plano explícito, porque números já publicados vão mudar. Frequentemente a resposta é aplicar a nova lógica só daqui para frente e corrigir o histórico em batch.

Para mudanças arriscadas eu uso **deploy paralelo**: subo a nova versão consumindo o mesmo tópico com um consumer group diferente, escrevendo num destino sombra, comparo os resultados por algumas horas ou dias, e só então faço o corte. Custa o dobro de compute durante a janela, e vale cada centavo — porque o modo de falha de um job de streaming com estado é sutil e frequentemente só aparece depois de horas de operação, com estado acumulado.

Este é, aliás, um dos melhores argumentos para não usar streaming quando não é necessário: em batch, mudar a lógica e reprocessar é uma tarde de trabalho.

---

## 3. Armadilhas comuns

**Dizer que exactly-once é simplesmente possível.** Sem distinguir delivery de processing semantics, e sem mencionar que o sink precisa participar, a resposta soa decorada. Entrevistadores usam essa pergunta justamente como filtro.

**Tratar streaming como "melhor" que batch.** Streaming é mais caro em operação, em reprocessamento, em testes e em debug. A resposta madura começa por perguntar se a latência é necessária.

**Confundir event time com processing time em agregações.** Agregar por processing time faz o resultado descrever o seu pipeline em vez do negócio, e destrói a reprodutibilidade. É um erro que passa despercebido até alguém comparar dois reprocessamentos.

**Achar que watermark garante completude.** É heurística. Sempre há dado que chega depois, e você precisa de uma estratégia explícita para ele — e de instrumentação medindo quanto está sendo descartado.

**Esquecer TTL no estado.** Um job que mantém estado por chave sem expiração cresce até morrer. Costuma quebrar semanas depois do deploy, quando ninguém associa mais o incidente à mudança.

**Achar que adicionar consumidores sempre aumenta o throughput em Kafka.** O paralelismo máximo de um consumer group é o número de partições. Consumidores extras ficam ociosos.

**Ignorar que o sink pode ser o gargalo.** Muito job "lento" está apenas esperando um destino lento. Escalar o processamento nesse caso não melhora nada e às vezes piora.

**Monitorar "o job está rodando" em vez de consumer lag.** Um job pode estar tecnicamente vivo e 6 horas atrasado. O sintoma que importa é lag, medido em tempo.

**Propor join entre dois streams sem mencionar limite temporal de estado.** Sem janela, o estado é ilimitado. Essa é a primeira coisa que um entrevistador espera ouvir nessa pergunta.

**Subestimar a dificuldade de mudar código com estado.** "É só fazer deploy" é a resposta de quem nunca operou streaming. Savepoints, compatibilidade de estado e deploy paralelo são o vocabulário certo.

**Aceitar "tempo real" como requisito sem interrogar.** Traduzir a exigência em decisão de negócio e em custo é parte do trabalho, e entrevistadores frequentemente estão testando exatamente isso.

**Confundir micro-batch com batch.** Spark Structured Streaming em micro-batch é streaming: mantém estado, offsets e semântica de janela. A diferença para streaming registro-a-registro é latência, não modelo.
