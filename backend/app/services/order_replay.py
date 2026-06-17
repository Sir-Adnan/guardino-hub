from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger import LedgerTransaction
from app.models.order import Order, OrderStatus, OrderType
from app.models.reseller import Reseller
from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser
from app.schemas.ops import OpResult
from app.schemas.reseller_user_ops import CreateUserResponse
from app.services.idempotency import find_order_by_request_id, request_id_from


async def _ledger_summary(
    db: AsyncSession,
    *,
    order_id: int,
    fallback_balance: int,
) -> tuple[int, int, int]:
    q_ledger = await db.execute(
        select(LedgerTransaction).where(LedgerTransaction.order_id == order_id)
    )
    ledger_rows = q_ledger.scalars().all()
    charged = sum(max(0, -int(tx.amount or 0)) for tx in ledger_rows)
    refunded = sum(max(0, int(tx.amount or 0)) for tx in ledger_rows)
    balance_after = int(ledger_rows[-1].balance_after) if ledger_rows else int(fallback_balance or 0)
    return charged, refunded, balance_after


def _coerce_order_type(order: Order) -> OrderType | str:
    try:
        return order.type if isinstance(order.type, OrderType) else OrderType(order.type)
    except Exception:
        return str(order.type)


def _coerce_order_status(order: Order) -> OrderStatus | str:
    try:
        return order.status if isinstance(order.status, OrderStatus) else OrderStatus(order.status)
    except Exception:
        return str(order.status)


def _ensure_completed_order(
    order: Order,
    *,
    expected_types: set[OrderType],
) -> None:
    if _coerce_order_type(order) not in expected_types:
        raise HTTPException(status_code=409, detail="request_id was already used for another operation.")
    if _coerce_order_status(order) != OrderStatus.completed or not order.user_id:
        raise HTTPException(status_code=409, detail="request_id is already in progress; retry shortly.")


async def op_result_for_order(
    db: AsyncSession,
    reseller: Reseller,
    order: Order,
    *,
    expected_types: set[OrderType],
    request_id: str,
) -> OpResult:
    _ensure_completed_order(order, expected_types=expected_types)
    charged, refunded, balance_after = await _ledger_summary(
        db,
        order_id=order.id,
        fallback_balance=int(reseller.balance or 0),
    )
    return OpResult(
        ok=True,
        order_id=order.id,
        request_id=request_id,
        charged_amount=charged,
        refunded_amount=refunded,
        new_balance=balance_after,
        user_id=int(order.user_id),
        detail="idempotent_replay=1",
    )


async def existing_op_result(
    db: AsyncSession,
    reseller: Reseller,
    request: Request,
    payload,
    *,
    expected_types: set[OrderType],
) -> tuple[str | None, OpResult | None]:
    request_id = request_id_from(request, payload)
    if not request_id:
        return None, None
    existing_order = await find_order_by_request_id(db, reseller_id=reseller.id, request_id=request_id)
    if not existing_order:
        return request_id, None
    return request_id, await op_result_for_order(
        db,
        reseller,
        existing_order,
        expected_types=expected_types,
        request_id=request_id,
    )


async def create_user_response_for_order(
    db: AsyncSession,
    *,
    base_url: str,
    reseller: Reseller,
    order: Order,
    request_id: str | None,
) -> CreateUserResponse:
    _ensure_completed_order(order, expected_types={OrderType.create})

    q_user = await db.execute(select(GuardinoUser).where(GuardinoUser.id == order.user_id))
    user = q_user.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=409, detail="request_id points to a missing user.")

    q_subs = await db.execute(select(SubAccount.node_id).where(SubAccount.user_id == user.id))
    nodes_provisioned = [int(node_id) for node_id in q_subs.scalars().all()]
    charged_amount, _refunded, balance_after = await _ledger_summary(
        db,
        order_id=order.id,
        fallback_balance=int(reseller.balance or 0),
    )
    subscription_url = base_url.rstrip("/") + f"/api/v1/sub/{user.master_sub_token}"
    return CreateUserResponse(
        user_id=user.id,
        label=user.label,
        order_id=order.id,
        request_id=request_id,
        master_sub_token=user.master_sub_token,
        subscription_url=subscription_url,
        expire_at=user.expire_at,
        charged_amount=charged_amount,
        balance_after=balance_after,
        nodes_provisioned=nodes_provisioned,
    )


async def existing_create_user_response(
    db: AsyncSession,
    request: Request,
    reseller: Reseller,
    payload,
) -> tuple[str | None, CreateUserResponse | None]:
    request_id = request_id_from(request, payload)
    if not request_id:
        return None, None
    existing_order = await find_order_by_request_id(db, reseller_id=reseller.id, request_id=request_id)
    if not existing_order:
        return request_id, None
    response = await create_user_response_for_order(
        db,
        base_url=str(request.base_url),
        reseller=reseller,
        order=existing_order,
        request_id=request_id,
    )
    return request_id, response
