# 06 — SQL Conceitual para Entrevista

> Window functions · Tipos de join e seus custos · Ordem lógica de execução · Planos de execução · Índices · NULLs · Otimização de query

SQL cai em praticamente toda entrevista de engenharia de dados. Este arquivo não ensina sintaxe — foca no que entrevistadores realmente testam: se você entende **o que o banco faz** quando executa sua query, e se sabe explicar por que ela está lenta.

---

## 1. Resumo conceitual

### 1.1 Ordem lógica de execução — a base de metade das perguntas

SQL é declarativo: você escreve na ordem `SELECT ... FROM ... WHERE ...`, mas o banco avalia numa ordem diferente. A **ordem lógica** é:

1. `FROM` / `JOIN` — monta o conjunto de linhas
2. `WHERE` — filtra linhas individuais
3. `GROUP BY` — agrupa
4. `HAVING` — filtra grupos
5. `SELECT` — projeta colunas e avalia expressões
6. `DISTINCT`
7. `ORDER BY`
8. `LIMIT` / `OFFSET`

Window functions são avaliadas **depois** do `GROUP BY`/`HAVING` e junto com o `SELECT`, antes do `DISTINCT` e do `ORDER BY`.

Essa ordem explica um conjunto grande de comportamentos que confundem gente:

- **Por que não dá para usar um alias do `SELECT` no `WHERE`?** Porque o `WHERE` é avaliado antes do `SELECT` — o alias ainda não existe. (Alguns bancos permitem no `GROUP BY` e no `ORDER BY`, que vêm depois.)
- **Por que `WHERE` não aceita função de agregação?** Porque a agregação só acontece no `GROUP BY`. Para filtrar por agregado, use `HAVING`.
- **Por que não dá para filtrar por window function no `WHERE`?** Porque ela é avaliada depois. A solução é envolver em subquery ou CTE e filtrar no nível externo — é a pergunta de "top N por grupo", uma das mais comuns que existem.
- **`WHERE` vs `HAVING`:** `WHERE` filtra linhas antes de agrupar (mais eficiente, reduz o volume que entra na agregação); `HAVING` filtra grupos depois. Filtrar no `WHERE` quando possível é uma otimização real.

**Cuidado:** ordem *lógica* não é ordem *física*. O otimizador pode reordenar tudo desde que o resultado seja equivalente — inclusive empurrar filtros para dentro de joins e para o storage. A ordem lógica define a **semântica**; o plano define a **execução**.

### 1.2 Joins e seus custos

**Tipos lógicos:**
- `INNER`: só as linhas com correspondência dos dois lados.
- `LEFT` / `RIGHT OUTER`: todas as linhas de um lado, NULL no outro quando não há par.
- `FULL OUTER`: todas de ambos os lados.
- `CROSS`: produto cartesiano.
- `SEMI` (`EXISTS`, `IN`): linhas da esquerda que **têm** correspondência, sem duplicar e sem trazer colunas da direita.
- `ANTI` (`NOT EXISTS`): linhas da esquerda que **não têm** correspondência.

Semi e anti join são o conceito mais subestimado dessa lista. Se você só precisa saber "existe correspondência?", um semi join é muito mais barato que um inner join seguido de `DISTINCT`, porque o engine para na primeira correspondência encontrada e não materializa duplicatas.

**Algoritmos físicos** — é isso que o entrevistador quer ouvir quando pergunta "qual o custo de um join":

**Nested Loop Join.** Para cada linha da tabela externa, procura correspondências na interna. Custo O(N×M) na forma ingênua, mas **O(N × log M)** se houver índice na chave de junção da tabela interna. É excelente quando a tabela externa é muito pequena e a interna tem índice; péssimo quando ambas são grandes sem índice.

**Hash Join.** Constrói uma tabela hash com o lado menor (build side) e varre o lado maior (probe side), consultando o hash. Custo aproximadamente O(N+M). É o algoritmo dominante em analytics. Requer que o build side caiba em memória — se não couber, o engine faz *spill* para disco e particiona recursivamente, o que degrada bastante. Só funciona para condições de igualdade.

**Sort-Merge Join.** Ordena os dois lados pela chave e percorre em paralelo. Custo O(N log N + M log M), ou apenas O(N+M) se os dados já estiverem ordenados ou co-particionados. É o preferido quando os lados são grandes e comparáveis em tamanho, quando já há ordenação disponível, e é o único dos três que lida naturalmente com condições de desigualdade em alguns engines.

**Broadcast (Map-side) Join** — em engines distribuídas. Se um lado é pequeno, envia uma cópia dele para todos os nós e faz o join localmente, eliminando o shuffle. É a otimização de maior impacto em Spark e similares. O limite é a memória: o lado transmitido é replicado em cada executor.

**O que determina a escolha:** tamanho relativo das tabelas, existência de índices, cardinalidade estimada, seletividade dos filtros, e se os dados já estão ordenados ou particionados pela chave. O otimizador decide com base em **estatísticas** — e é por isso que estatísticas desatualizadas produzem planos catastróficos.

**Ordem de join importa muito.** Com N tabelas há um número fatorial de ordens possíveis. Juntar primeiro as tabelas que mais reduzem o volume mantém os resultados intermediários pequenos. Otimizadores tentam encontrar a melhor ordem, mas com muitas tabelas eles limitam a busca por custo de planejamento — e com estimativas ruins, erram feio.

### 1.3 Window functions

Uma window function computa um valor para cada linha considerando um **conjunto de linhas relacionadas**, sem colapsar as linhas como faz `GROUP BY`. Essa é a diferença essencial: agregação reduz N linhas a 1; window preserva as N linhas e adiciona a informação agregada a cada uma.

Anatomia:

```
FUNÇÃO() OVER (
  PARTITION BY <divide em grupos independentes>
  ORDER BY     <define a ordem dentro do grupo>
  <frame>      <define quais linhas do grupo entram no cálculo>
)
```

**Categorias:**

*Ranking:* `ROW_NUMBER()` (sempre único, sem empate), `RANK()` (empates recebem o mesmo valor e o próximo pula — 1,1,3), `DENSE_RANK()` (empates recebem o mesmo valor e não pula — 1,1,2), `NTILE(n)` (divide em n baldes), `PERCENT_RANK()`, `CUME_DIST()`.

A diferença entre `RANK` e `DENSE_RANK` é uma pergunta de entrevista clássica, e a resposta completa inclui **quando usar cada uma**: `ROW_NUMBER` para deduplicar (escolher uma linha por grupo), `RANK` quando lacunas na numeração são semanticamente corretas (posição em competição), `DENSE_RANK` quando você quer "os 3 maiores valores distintos" e não "as 3 primeiras linhas".

*Offset:* `LAG(col, n)` e `LEAD(col, n)` acessam linhas anteriores/posteriores — a base de qualquer cálculo de variação período a período. `FIRST_VALUE`, `LAST_VALUE`, `NTH_VALUE`.

*Agregação como window:* `SUM`, `AVG`, `COUNT`, `MIN`, `MAX` com `OVER` — dão totais acumulados, médias móveis e percentual sobre o total do grupo.

**Frames — o detalhe que separa quem sabe de quem decorou.**

O frame define quais linhas dentro da partição entram no cálculo:
- `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — do início até a linha atual (acumulado).
- `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` — janela móvel de 7 linhas.
- `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` — a partição inteira.
- `RANGE` em vez de `ROWS` opera sobre **valores** da coluna de ordenação, não sobre contagem de linhas — o que muda o resultado quando há empates.

**A pegadinha mais famosa:** quando você usa `ORDER BY` dentro do `OVER` sem especificar frame, o padrão é `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. Isso significa que `SUM(x) OVER (PARTITION BY g ORDER BY d)` dá um **acumulado**, não o total do grupo. E `LAST_VALUE(x) OVER (PARTITION BY g ORDER BY d)` retorna o valor da **linha atual**, não o último da partição — porque o frame termina na linha corrente. Para o total do grupo, ou você omite o `ORDER BY`, ou especifica o frame como `UNBOUNDED FOLLOWING`. Saber isso é um marcador confiável de experiência real.

Um segundo detalhe: com `RANGE` e empates na coluna de ordenação, todas as linhas empatadas compartilham o mesmo valor acumulado, porque `RANGE` inclui todos os peers. Com `ROWS`, cada linha tem seu próprio acumulado. É a fonte de bugs sutis em cálculos de saldo.

**Performance:** window functions exigem particionar e ordenar os dados. Em engine distribuída, `PARTITION BY` gera shuffle pela chave e `ORDER BY` gera ordenação dentro da partição. Uma window sem `PARTITION BY` é especialmente cara: obriga a colocar **tudo numa única partição**, serializando o cálculo num único nó — é um erro grave em volume alto. Múltiplas windows com a mesma cláusula `OVER` costumam compartilhar um único shuffle; com cláusulas diferentes, cada uma pode gerar o seu.

### 1.4 Planos de execução

Um plano de execução é a árvore de operadores que o banco vai executar. Ler plano é a habilidade prática mais valiosa deste arquivo.

**`EXPLAIN` vs `EXPLAIN ANALYZE`:** o primeiro mostra o plano **estimado**, sem executar; o segundo executa e mostra os números **reais**. A informação mais valiosa é a comparação entre linhas estimadas e linhas reais — uma divergência de ordem de grandeza indica estatísticas ruins ou correlação entre colunas que o otimizador não modelou, e é a causa raiz da maioria dos planos ruins.

**O que procurar num plano:**

- **Scan type.** `Seq Scan` / `Full Table Scan` sobre tabela grande com filtro seletivo indica índice ausente ou não utilizável. Mas atenção: full scan **não é sempre ruim** — se a query lê 60% da tabela, varrer sequencialmente é mais rápido que pular por índice, e o otimizador sabe disso.
- **Estimativa vs realidade.** Como acima. É o primeiro lugar para olhar.
- **Algoritmo de join escolhido.** Nested loop com estimativa errada sobre uma tabela grande é o clássico "a query rodava em 2 segundos e agora leva 40 minutos".
- **Spill para disco.** Operações de hash e sort que não cabem na memória de trabalho vazam para disco. É frequentemente a causa de lentidão desproporcional.
- **Ordem e volume dos intermediários.** Se um join intermediário produz bilhões de linhas que depois são filtradas, a ordem está errada.
- **Filtros aplicados tarde.** Predicados que poderiam ter sido empurrados para o scan mas aparecem no topo da árvore.
- **Em engines distribuídas:** número de shuffles (`Exchange`), tamanho dos dados trocados, e se o broadcast aconteceu onde deveria.

**Predicate pushdown** é empurrar o filtro o mais perto possível da fonte, para ler menos dados. **Projection pushdown / column pruning** é o mesmo para colunas. Em formatos colunares e lakehouses, esses dois mecanismos são responsáveis pela maior parte do ganho de performance — e é por isso que aplicar uma função sobre a coluna filtrada (`WHERE YEAR(data) = 2026`) é tão danoso: impede o pushdown e o uso de índice, forçando varredura completa. A forma correta é `WHERE data >= '2026-01-01' AND data < '2027-01-01'`, que preserva a sargabilidade.

**SARGable** (Search ARGument able) é o termo para um predicado que o engine consegue usar para acesso direto via índice ou pruning. Predicados não-sargáveis: função sobre a coluna, `LIKE '%algo'` (curinga à esquerda), cast implícito por tipo incompatível, e `OR` sobre colunas diferentes em alguns casos. É um vocabulário que impressiona quando usado corretamente.

### 1.5 Índices

Um índice é uma estrutura auxiliar que acelera a busca ao custo de espaço e de escrita mais lenta (cada `INSERT`/`UPDATE`/`DELETE` precisa atualizar todos os índices afetados).

**Tipos:**

- **B-tree**: o padrão. Suporta igualdade, intervalo e ordenação. Cobre a esmagadora maioria dos casos.
- **Hash**: só igualdade, e frequentemente sem vantagem real sobre B-tree nos bancos modernos.
- **Bitmap**: eficiente para colunas de baixa cardinalidade em ambiente analítico, permitindo combinar condições com operações de bits. Péssimo sob escrita concorrente, por isso é raro em OLTP.
- **GIN / GiST / invertido**: para busca em texto, arrays, JSON e dados geoespaciais.
- **Colunar / zone maps / min-max**: em warehouses, o "índice" costuma ser estatística por bloco (min, max, contagem de nulos), permitindo pular blocos inteiros sem lê-los. Não é índice no sentido tradicional, mas cumpre o papel de pruning.

**Conceitos que caem:**

**Clustered vs non-clustered.** Um índice clustered define a **ordem física** das linhas na tabela — por isso só pode haver um. Non-clustered é uma estrutura separada que aponta para as linhas. Buscar por índice non-clustered e depois buscar a linha completa é o "bookmark lookup", que pode ser caro se muitas linhas forem retornadas.

**Covering index.** Um índice que contém todas as colunas de que a query precisa, permitindo respondê-la **sem tocar na tabela** (index-only scan). É uma das otimizações de maior impacto e frequentemente subutilizada.

**Índice composto e a regra do prefixo mais à esquerda.** Um índice em `(a, b, c)` serve para filtros em `a`, em `(a,b)` e em `(a,b,c)` — mas **não** para um filtro só em `b` ou só em `c`. A ordem das colunas no índice é uma decisão de projeto: normalmente coloca-se primeiro a coluna usada em igualdade e com maior seletividade, e a coluna de intervalo por último, porque depois de um predicado de intervalo o índice deixa de conseguir refinar pelas colunas seguintes.

**Seletividade.** Índice em coluna de baixa cardinalidade (`ativo` booleano) tipicamente não ajuda: o otimizador vai preferir full scan porque metade das linhas seria retornada de qualquer forma. Índices funcionam quando filtram uma pequena fração das linhas.

**Por que não indexar tudo:** cada índice custa espaço, torna toda escrita mais lenta, consome cache que poderia servir dados, e aumenta o espaço de busca do otimizador (que pode acabar escolhendo pior). Índices não usados são puro custo, e identificá-los e removê-los é uma tarefa real de manutenção.

**Em warehouses colunares**, índices B-tree tradicionais frequentemente não existem ou não ajudam. O equivalente é **particionamento** (pular arquivos inteiros), **clustering / sort keys / Z-ordering** (agrupar fisicamente valores similares para melhorar o pruning por min-max), e as estatísticas por bloco. Saber traduzir o conceito de índice para o mundo analítico é uma resposta de nível intermediário/avançado.

### 1.6 NULL — a fonte silenciosa de bugs

SQL usa lógica de três valores: verdadeiro, falso e **desconhecido**. NULL significa "valor desconhecido", não "vazio" nem "zero".

Consequências que caem em entrevista:

- `NULL = NULL` é **desconhecido**, não verdadeiro. Comparação com NULL exige `IS NULL` / `IS NOT NULL`.
- `WHERE coluna != 'X'` **exclui** as linhas onde a coluna é NULL, porque `NULL != 'X'` é desconhecido, e desconhecido não passa no filtro. Isso surpreende muita gente e é uma fonte real de números errados.
- `NOT IN` com uma subquery que retorna qualquer NULL devolve **conjunto vazio**. Motivo: `x NOT IN (1, 2, NULL)` equivale a `x != 1 AND x != 2 AND x != NULL`, e a última condição é sempre desconhecida, o que torna a expressão inteira nunca verdadeira. `NOT EXISTS` não tem esse problema e é a alternativa segura. Esta é provavelmente a pegadinha mais cobrada de SQL em entrevistas de dados.
- `COUNT(*)` conta linhas; `COUNT(coluna)` **ignora NULLs**. Diferença que muda resultados.
- Funções de agregação (`SUM`, `AVG`) ignoram NULLs. `AVG` de uma coluna com NULLs divide pela contagem de não-nulos, não pelo total de linhas — o que pode ser ou não o que você quer.
- `NULL` em concatenação de string propaga NULL na maioria dos bancos.
- `GROUP BY` trata todos os NULLs como um único grupo, embora sejam "desconhecidos diferentes" logicamente. É uma inconsistência prática da especificação, e é bom saber.
- `ORDER BY` posiciona NULLs de forma diferente entre bancos; use `NULLS FIRST` / `NULLS LAST` explicitamente.

### 1.7 Otimização de query: um método

Quando perguntam "essa query está lenta, o que você faz?", o que se avalia é **método**, não truques. Uma sequência defensável:

1. **Medir e delimitar.** Está lenta sempre ou só às vezes? Lenta para todos ou para um conjunto de parâmetros? Regrediu recentemente? Se regrediu, algo mudou: volume, estatísticas, plano, ou infraestrutura.
2. **Ler o plano com `EXPLAIN ANALYZE`.** Comparar estimado com real.
3. **Reduzir o volume lido.** É quase sempre onde está o ganho: partition pruning, predicate pushdown, selecionar só as colunas necessárias, filtrar antes de juntar.
4. **Verificar predicados sargáveis.** Função sobre coluna filtrada, cast implícito e curinga à esquerda destroem uso de índice e pruning.
5. **Verificar joins.** Algoritmo escolhido, ordem, e se a cardinalidade estimada bate. Verificar explosão de linhas por chave duplicada.
6. **Atualizar estatísticas.** Frequentemente resolve sozinho, e é barato de testar.
7. **Considerar índice ou clustering.** Depois de esgotar o que é gratuito, não antes.
8. **Reescrever a query.** Substituir `NOT IN` por `NOT EXISTS`, `DISTINCT` por semi join, subquery correlacionada por join ou window, `OR` por `UNION ALL` quando isso permite usar índices.
9. **Materializar.** Se o cálculo é recorrente e caro, uma tabela agregada ou view materializada troca compute recorrente por storage e latência de atualização.
10. **Questionar a pergunta.** Frequentemente a query calcula muito mais do que o usuário precisa. Reduzir o escopo é a otimização mais eficaz que existe.

Sobre **CTEs**: em muitos bancos modernos elas são inlined e otimizadas junto com a query, mas em alguns (versões antigas do PostgreSQL, por exemplo) são **materializadas** e funcionam como barreira de otimização, impedindo predicate pushdown. Saber que o comportamento varia — e que é preciso verificar no plano em vez de assumir — é uma resposta melhor do que afirmar categoricamente.

Sobre **`SELECT *`**: em formato colunar é especialmente danoso, porque anula o column pruning que é a principal vantagem do formato. Também quebra contratos quando o schema muda.

---

## 2. Perguntas de entrevista

### 🟢 Básico

**🟢 P1. Qual a diferença entre `WHERE` e `HAVING`?**

*Resposta modelo:* `WHERE` filtra linhas antes do agrupamento; `HAVING` filtra grupos depois da agregação. Por isso `WHERE` não aceita funções de agregação — elas ainda não foram calculadas. E quando é possível filtrar no `WHERE`, é melhor, porque reduz o volume que entra na agregação em vez de agregar tudo e descartar depois.

---

**🟢 P2. Diferença entre `INNER JOIN` e `LEFT JOIN`.**

*Resposta modelo:* Inner retorna só as linhas com correspondência dos dois lados. Left retorna todas as linhas da tabela da esquerda, preenchendo com NULL quando não há par à direita.

A pegadinha prática: se você coloca uma condição sobre a tabela da direita no `WHERE` de um `LEFT JOIN`, ele se comporta como inner, porque as linhas sem correspondência têm NULL naquela coluna e são eliminadas pelo filtro. Para preservar o comportamento de left, a condição precisa estar no `ON`, não no `WHERE`.

---

**🟢 P3. O que faz `GROUP BY` e o que é uma window function?**

*Resposta modelo:* `GROUP BY` colapsa várias linhas em uma por grupo, retornando os agregados. Window function calcula um valor considerando um conjunto de linhas relacionadas mas **preserva** todas as linhas — cada linha ganha o valor agregado junto com seus próprios dados.

É a diferença entre "receita total por categoria" (uma linha por categoria) e "cada venda com a receita total da sua categoria ao lado" (todas as vendas, mais uma coluna).

---

**🟢 P4. Diferença entre `RANK()`, `DENSE_RANK()` e `ROW_NUMBER()`.**

*Resposta modelo:* `ROW_NUMBER` numera sequencialmente sem empate — se dois valores são iguais, um recebe 1 e o outro 2, arbitrariamente. `RANK` dá o mesmo número para empates e pula os seguintes: 1, 1, 3. `DENSE_RANK` dá o mesmo número para empates e não pula: 1, 1, 2.

Na prática, uso `ROW_NUMBER` para deduplicar — escolher uma linha por grupo; `RANK` quando a lacuna é semanticamente correta, como posição em competição; e `DENSE_RANK` quando quero os N maiores valores distintos, e não as N primeiras linhas.

---

**🟢 P5. O que é um índice e por que não indexar todas as colunas?**

*Resposta modelo:* É uma estrutura auxiliar que permite localizar linhas sem varrer a tabela inteira. Não se indexa tudo porque cada índice ocupa espaço, torna toda escrita mais lenta (o índice precisa ser atualizado a cada insert, update e delete), consome cache que poderia guardar dados, e amplia o espaço de busca do otimizador.

Além disso, índice em coluna de baixa seletividade normalmente não é usado: se o filtro retorna metade da tabela, varredura sequencial é mais rápida que pular por índice, e o otimizador vai escolher o scan.

---

### 🟡 Intermediário

**🟡 P6. Explique os algoritmos de join e quando cada um é escolhido.**

*Resposta modelo:* Nested loop percorre a tabela externa e, para cada linha, busca correspondências na interna — bom quando a externa é pequena e a interna tem índice na chave, porque aí o custo é N vezes log M. Ruim quando ambas são grandes sem índice.

Hash join constrói uma tabela hash com o lado menor e varre o maior consultando o hash. Custo aproximadamente linear na soma dos tamanhos, e é o dominante em analytics. Exige que o build side caiba em memória; se não couber, faz spill para disco e degrada.

Sort-merge ordena os dois lados e percorre em paralelo. Custa a ordenação, mas se os dados já estão ordenados ou co-particionados, é linear. É o preferido para dois lados grandes e comparáveis.

Em engine distribuída, tem ainda o broadcast join: se um lado é pequeno, uma cópia é enviada a todos os nós e o join é local, eliminando shuffle — é a otimização de maior impacto quando aplicável.

A escolha depende dos tamanhos relativos, de índices disponíveis, da cardinalidade estimada e de ordenação preexistente. E depende de **estatísticas** — estatísticas desatualizadas são a causa mais comum de o otimizador escolher nested loop sobre uma tabela que ele acha que tem mil linhas e tem dez milhões.

---

**🟡 P7. Você tem uma tabela de vendas e precisa do top 3 produtos por categoria. Como resolve conceitualmente?**

*Resposta modelo:* Window function com `ROW_NUMBER()` ou `DENSE_RANK()` particionando por categoria e ordenando por valor decrescente, envolvido numa subquery ou CTE, e filtrando pelo ranking no nível externo.

Precisa da subquery porque window functions são avaliadas depois do `WHERE` na ordem lógica, então não dá para filtrar por elas diretamente no `WHERE`.

A escolha entre `ROW_NUMBER` e `DENSE_RANK` depende do que "top 3" significa para o negócio: `ROW_NUMBER` devolve exatamente 3 linhas, quebrando empates arbitrariamente; `DENSE_RANK` devolve todos os produtos que estão nos 3 maiores valores, podendo trazer mais de 3 linhas se houver empate. Eu perguntaria qual comportamento se espera em caso de empate — essa é a parte que o entrevistador está avaliando.

---

**🟡 P8. O que é predicate pushdown e por que `WHERE YEAR(data) = 2026` é problemático?**

*Resposta modelo:* Predicate pushdown é empurrar o filtro o mais perto possível da fonte, para ler menos dados — no limite, até o formato de arquivo ou o storage, que consegue pular blocos e arquivos inteiros usando estatísticas de min/max.

`YEAR(data) = 2026` aplica uma função sobre a coluna, o que torna o predicado não-sargável: o engine não consegue mapear a condição para um intervalo de valores da coluna, então não usa índice e não faz pruning de partição — resultado, varredura completa. A forma correta é `data >= '2026-01-01' AND data < '2027-01-01'`, que preserva a relação direta com os valores armazenados.

O mesmo problema aparece com cast implícito por tipo incompatível e com `LIKE '%algo'`, onde o curinga à esquerda impede o uso da ordenação do índice.

---

**🟡 P9. `NOT IN` com subquery: qual o risco?**

*Resposta modelo:* Se a subquery retornar qualquer NULL, o resultado é conjunto vazio. `x NOT IN (1, 2, NULL)` equivale a `x != 1 AND x != 2 AND x != NULL`, e essa última comparação é sempre desconhecida, o que impede a expressão de ser verdadeira para qualquer linha.

É especialmente perigoso porque falha silenciosamente: a query roda, retorna zero linhas, e alguém conclui que "não tem nenhum caso". Uso `NOT EXISTS`, que trata NULL corretamente e normalmente tem plano melhor por ser um anti join, ou `LEFT JOIN ... WHERE chave_direita IS NULL`.

---

**🟡 P10. Como você lê um plano de execução? O que procura primeiro?**

*Resposta modelo:* Uso `EXPLAIN ANALYZE` para ter os números reais, não só as estimativas, e a primeira coisa que olho é a **divergência entre linhas estimadas e linhas reais**. Se o otimizador acha que um passo devolve mil linhas e ele devolve dez milhões, todas as decisões subsequentes estão erradas — e a causa costuma ser estatística desatualizada ou correlação entre colunas que ele não modela.

Depois procuro: full scan sobre tabela grande com filtro seletivo (índice ausente ou não utilizável); o algoritmo de join escolhido, especialmente nested loop com estimativa errada, que é o clássico da query que "de repente" ficou 100 vezes mais lenta; spill para disco em hash ou sort, que causa lentidão desproporcional; e o tamanho dos resultados intermediários, para ver se a ordem de join está mantendo tudo pequeno.

Em engine distribuída, olho também o número de shuffles e o volume trocado, e se o broadcast aconteceu onde deveria.

O que eu não faria é assumir que full scan é sempre ruim — se a query lê 60% da tabela, varrer é mais rápido que pular por índice, e o otimizador está certo.

---

**🟡 P11. O que é um covering index?**

*Resposta modelo:* É um índice que contém todas as colunas que a query precisa — as do filtro e as do `SELECT` — de modo que o banco responde a consulta lendo só o índice, sem tocar na tabela. Isso elimina o lookup de volta à tabela para cada linha, que é o custo dominante quando muitas linhas são retornadas por um índice non-clustered.

É uma das otimizações de maior impacto e mais subutilizadas. O custo é um índice mais largo, que ocupa mais espaço e torna a escrita mais cara — então vale para consultas frequentes e críticas, não para tudo.

---

### 🔴 Avançado

**🔴 P12. `SUM(valor) OVER (PARTITION BY cliente ORDER BY data)` — o que isso retorna?**

*Resposta modelo:* Um **acumulado** (running total) por cliente ao longo do tempo, não o total do cliente. Porque quando há `ORDER BY` dentro do `OVER` sem frame explícito, o padrão é `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — ou seja, do início da partição até a linha atual.

Para obter o total do cliente em todas as linhas, ou removo o `ORDER BY`, ou especifico `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.

Há um detalhe adicional: o padrão é `RANGE`, não `ROWS`. Com `RANGE`, linhas empatadas na coluna de ordenação compartilham o mesmo acumulado, porque todos os peers entram no frame. Com `ROWS`, cada linha tem o seu. Se houver múltiplas transações do mesmo cliente na mesma data, os dois produzem resultados diferentes, e isso é uma fonte real de bugs em cálculo de saldo.

*Follow-up frequente:* "E `LAST_VALUE` com `ORDER BY`?" → Retorna o valor da linha atual, pelo mesmo motivo: o frame termina na linha corrente. Para o último valor da partição, é preciso frame explícito até `UNBOUNDED FOLLOWING` — ou usar `FIRST_VALUE` com ordenação invertida, que é a forma que eu prefiro porque é menos sujeita a erro.

---

**🔴 P13. Uma query que rodava em 2 segundos passou a levar 40 minutos, sem mudança no código. Como investiga?**

*Resposta modelo:* Como o código não mudou, algo no ambiente mudou. Investigo em ordem de probabilidade.

**Mudança de plano.** É a causa mais frequente. O volume cresceu e ultrapassou um limiar que fez o otimizador trocar de algoritmo — tipicamente de hash join para nested loop, ou perder um broadcast join. Comparo o plano atual com o histórico, se o banco guardar.

**Estatísticas desatualizadas.** Se houve uma carga grande e as estatísticas não foram recoletadas, o otimizador estima com dados velhos. É barato de testar: atualizo as estatísticas e reexecuto.

**Crescimento de dados ou skew novo.** Uma chave que antes era balanceada passou a concentrar. Ou uma tabela cresceu e o build side do hash join deixou de caber em memória, passando a fazer spill.

**Índice removido, desabilitado ou fragmentado.** Vale conferir.

**Contenção externa.** Outra carga concorrente consumindo I/O, memória ou lock. Se a query está esperando lock, o plano está ótimo e o problema é outro completamente — verificar isso cedo evita horas perdidas.

**Parameter sniffing**, em bancos que cacheiam plano por consulta parametrizada: o plano foi compilado para um valor de parâmetro atípico e ficou cacheado. Sintoma característico: lenta para alguns parâmetros e rápida para outros.

Meu primeiro passo concreto seria `EXPLAIN ANALYZE` comparando estimado com real, e em paralelo verificar se há espera por lock ou recurso — porque essas duas checagens separam "plano ruim" de "sistema ocupado", que exigem soluções completamente diferentes.

---

**🔴 P14. Como você otimizaria uma consulta analítica que agrega bilhões de linhas e roda várias vezes por dia?**

*Resposta modelo:* Vou de fora para dentro, do mais barato ao mais estrutural.

**Primeiro, reduzir o que é lido.** Verifico se há partition pruning acontecendo de fato — não basta a tabela ser particionada, o filtro precisa ser sargável sobre a coluna de partição. Verifico column pruning: `SELECT *` numa tabela colunar anula a principal vantagem do formato. E verifico se o filtro mais seletivo está sendo aplicado o mais cedo possível.

**Segundo, o layout físico.** Se as consultas filtram recorrentemente por uma segunda dimensão além da partição, clustering ou Z-ordering nessa coluna melhora muito o pruning por min/max, sem criar mais um nível de partição física. E conferir file sizing: milhares de arquivos pequenos custam mais em overhead de abertura do que em leitura.

**Terceiro, evitar recomputar.** Se a mesma agregação roda várias vezes por dia sobre dados que mudam uma vez por dia, materializar é a resposta óbvia: uma tabela agregada pré-calculada, ou view materializada com refresh incremental. Troco compute recorrente por storage e uma latência de atualização controlada — e essa é quase sempre a otimização de maior retorno nesse cenário.

**Quarto, agregação incremental.** Se o dado é append-only por período, agregar só o novo período e combinar com o histórico já agregado transforma um custo proporcional ao total num custo proporcional ao delta. Funciona para métricas aditivas; para `COUNT DISTINCT` exige estruturas aproximadas como HyperLogLog, que é um ótimo detalhe a mencionar.

**Quinto, questionar o requisito.** Muitas dessas queries calculam granularidade que ninguém usa, ou um histórico completo quando o usuário só olha 90 dias. Reduzir o escopo é a otimização mais eficaz e a mais ignorada.

Só depois disso eu consideraria mais hardware, que é a solução que resolve sintoma e mantém o custo para sempre.

---

**🔴 P15. Explique o problema de "explosão de linhas" em joins e como evitá-lo.**

*Resposta modelo:* Acontece quando você junta por uma chave que não é única do lado direito. Se cada linha da esquerda casa com N linhas da direita, o resultado tem N vezes mais linhas — e qualquer `SUM` sobre a métrica da esquerda passa a contar N vezes o mesmo valor.

É especialmente perigoso porque **o resultado parece plausível**: os números só ficam maiores, não aparece erro, e ninguém percebe até alguém reconciliar com outra fonte. É a causa mais comum de "o dashboard está com o número errado" que eu já vi.

Onde costuma acontecer: juntar a fato com uma dimensão SCD Tipo 2 sem filtrar pelo intervalo de validade — cada fato casa com todas as versões históricas da dimensão. Juntar com uma tabela que tem duplicatas não detectadas. Ou juntar duas fatos de grãos diferentes, que é um erro de modelagem.

Como prevenir: testar unicidade da chave de junção do lado direito como parte do pipeline, e não confiar na suposição; ao juntar com SCD Tipo 2, sempre filtrar pela validade ou pela flag de corrente, conforme a semântica desejada; usar semi join quando você só precisa saber se existe correspondência, em vez de inner join com `DISTINCT` depois; e comparar a contagem de linhas antes e depois do join como asserção — se o join deveria preservar a cardinalidade da esquerda, essa asserção pega o problema imediatamente.

Sobre a "correção" com `DISTINCT`: ela é um mascaramento perigoso. `DISTINCT` remove linhas idênticas, mas se as linhas duplicadas diferirem em alguma coluna, elas sobrevivem — e se você tinha duas transações legitimamente idênticas, o `DISTINCT` apaga uma delas. Quando vejo `DISTINCT` depois de um join, minha primeira suspeita é que o grão está errado.

---

## 3. Armadilhas comuns

**Colocar filtro da tabela da direita no `WHERE` de um `LEFT JOIN`.** Transforma o left em inner silenciosamente. A condição precisa ir no `ON`.

**Usar `NOT IN` com subquery que pode ter NULL.** Retorna vazio sem erro. Use `NOT EXISTS`.

**Achar que `SUM(...) OVER (PARTITION BY x ORDER BY y)` dá o total do grupo.** Dá o acumulado, por causa do frame padrão. E `LAST_VALUE` com `ORDER BY` retorna a linha atual pelo mesmo motivo.

**Aplicar função na coluna filtrada.** `WHERE YEAR(data) = 2026`, `WHERE UPPER(nome) = 'X'`, `WHERE CAST(id AS TEXT) = '5'` — todos destroem sargabilidade, uso de índice e partition pruning.

**Usar `DISTINCT` para corrigir duplicação de join.** Mascara o problema real (grão ou chave errada) e pode apagar linhas legitimamente distintas. Investigue a causa.

**`COUNT(coluna)` achando que conta linhas.** Ignora NULLs. `COUNT(*)` conta linhas.

**`SELECT *` em tabela colunar.** Anula o column pruning, que é a principal vantagem do formato, e quebra contratos quando o schema muda.

**Assumir que full scan é sempre ruim.** Se a query lê grande parte da tabela, scan é a escolha correta e o otimizador sabe disso.

**Window function sem `PARTITION BY` em volume alto.** Força todos os dados numa única partição, serializando o cálculo num nó só. É um dos erros mais caros em engine distribuída.

**Confiar que o índice será usado só porque existe.** Ele pode ser ignorado por baixa seletividade, por predicado não-sargável, por incompatibilidade de tipo, ou por estatísticas ruins. Confirme no plano.

**Esquecer que `WHERE coluna != 'X'` exclui NULLs.** Lógica de três valores. Se você quer incluí-los, precisa de `OR coluna IS NULL`.

**Otimizar antes de medir.** Reescrever a query por instinto sem ler o plano é o hábito mais comum e o menos produtivo. O entrevistador está avaliando método.

**Ignorar estatísticas.** É a causa mais frequente de plano ruim, é a mais barata de corrigir, e quase ninguém menciona espontaneamente.
