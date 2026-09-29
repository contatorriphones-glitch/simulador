#!/usr/bin/env bash
# Coleta estrutura, configuração e código-fonte do projeto Replit em um único arquivo
# (RELATORIO_SISTEMA.txt) para análise. Valores de segredos NÃO são incluídos.
OUT="RELATORIO_SISTEMA.txt"
EXC='node_modules|\.git|\.cache|\.upm|\.pythonlibs|\.local|\.config|dist|build|\.next|__pycache__|venv|\.venv|attached_assets'
{
echo "===== RELATORIO DO SISTEMA - $(date) ====="
echo; echo "===== AMBIENTE ====="
uname -a; cat /etc/os-release 2>/dev/null | head -3
for c in node npm pnpm yarn python3 pip psql; do command -v $c >/dev/null && echo "$c: $($c --version 2>&1 | head -1)"; done
echo "Diretorio: $(pwd)"
echo; echo "===== VARIAVEIS DE AMBIENTE / SECRETS (somente nomes) ====="
env | cut -d= -f1 | grep -vE '^(PATH|HOME|PWD|SHLVL|_|OLDPWD|TERM|LANG|HOSTNAME|NIX_.*|XDG_.*|LS_COLORS)$' | sort
echo; echo "===== GIT ====="
git remote -v 2>/dev/null | sed -E 's#://[^@/]+@#://***@#'
git branch -a 2>/dev/null; git log --oneline -30 2>/dev/null
echo; echo "===== ARVORE DE ARQUIVOS ====="
find . -type f 2>/dev/null | grep -vE "/($EXC)(/|$)" | sort | while read -r f; do printf '%8s  %s\n' "$(wc -c <"$f")" "$f"; done
echo; echo "===== ESQUEMA DO BANCO (sem dados) ====="
if [ -n "$DATABASE_URL" ] && command -v pg_dump >/dev/null; then pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges 2>&1
  echo; echo "--- Contagem de linhas por tabela ---"
  psql "$DATABASE_URL" -Atc "select relname||': '||n_live_tup from pg_stat_user_tables order by 1" 2>&1
else echo "(sem DATABASE_URL/pg_dump)"; fi
echo; echo "===== CONTEUDO DOS ARQUIVOS ====="
find . -type f 2>/dev/null | grep -vE "/($EXC)(/|$)" \
 | grep -vE '(\.env($|\.)|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tar|mp[34]|woff2?|ttf|eot|db|sqlite|lock|map)$|RELATORIO_SISTEMA|codigo_fonte\.tar\.gz)' \
 | sort | while read -r f; do
   s=$(wc -c <"$f"); if [ "$s" -gt 300000 ]; then echo; echo "##### $f (IGNORADO: $s bytes)"; continue; fi
   grep -Iq . "$f" 2>/dev/null || continue
   echo; echo "##### ARQUIVO: $f"; cat "$f"; echo
 done
echo; echo "===== FIM ====="
} > "$OUT" 2>&1
tar --exclude='node_modules' --exclude='.git' --exclude='.cache' --exclude='.upm' --exclude='.pythonlibs' \
    --exclude='.env*' --exclude='dist' --exclude='build' --exclude="$OUT" --exclude='codigo_fonte.tar.gz' \
    -czf codigo_fonte.tar.gz . 2>/dev/null
echo "PRONTO -> $OUT ($(du -h "$OUT" | cut -f1)) e codigo_fonte.tar.gz ($(du -h codigo_fonte.tar.gz | cut -f1))"
