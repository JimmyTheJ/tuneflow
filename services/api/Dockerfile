FROM python:3.12-slim

ARG PUID=10001
ARG PGID=10001

WORKDIR /app

RUN groupadd -g "${PGID}" tuneflow \
    && useradd -m -u "${PUID}" -g tuneflow -s /usr/sbin/nologin tuneflow

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /app/data \
    && chown -R tuneflow:tuneflow /app

USER tuneflow

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
