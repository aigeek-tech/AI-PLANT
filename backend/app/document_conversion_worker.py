from __future__ import annotations

import logging

from .document_conversion_service import describe_document_conversion_settings, run_conversion_worker_forever


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger(__name__).info("Starting document conversion worker: %s", describe_document_conversion_settings())
    run_conversion_worker_forever()


if __name__ == "__main__":
    main()
